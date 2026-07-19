/**
 * Report pipeline.
 *
 * Design rules:
 *  - Nothing runs in the HTTP request cycle. An audit takes 60-180s.
 *  - Every source is allowed to fail independently. A dead PageSpeed call must
 *    not cost us the whole report — the client is waiting and the agent is on
 *    the phone.
 *  - Credits are counted as we go, so admin can see burn per report.
 */

const { SERanking } = require('../services/seranking');
const { runTechnicalAudit, normaliseUrl } = require('../services/crawler');
const ai = require('../services/aiVisibility');
const { GooglePlaces } = require('../services/googlePlaces');
const scoring = require('../services/scoring');
const { Report, Settings } = require('../models');
const { renderReport } = require('../services/renderer');

const STEPS = [
  'Reading the website',
  'Checking search visibility',
  'Analysing backlinks',
  'Finding competitors',
  'Testing AI visibility',
  'Scoring and writing',
  'Building the PDF',
];

async function setProgress(reportId, pct, step) {
  await Report.update({ progress: pct, currentStep: step, status: 'running' }, { where: { id: reportId } });
}

/** Never let one source sink the report. */
async function safe(label, fn, fallback = null) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[audit] ${label} failed:`, e.message);
    return fallback;
  }
}

function toDomain(website) {
  return normaliseUrl(website).hostname.replace(/^www\./, '');
}

async function runReport(reportId) {
  const started = Date.now();
  let credits = 0;

  const report = await Report.findByPk(reportId);
  if (!report) throw new Error('Report not found');

  const settings = await Settings.findOne({ where: { singleton: 'settings' } });
  if (!settings) throw new Error('Settings not configured');

  const serKey = settings.getKey('seranking');
  const claudeKey = settings.getKey('anthropic');
  const psKey = settings.getKey('pagespeed');

  if (!serKey) throw new Error('SE Ranking API key not configured. Add it in Admin → Settings.');
  if (!claudeKey) throw new Error('Claude API key not configured. Add it in Admin → Settings.');

  const se = new SERanking(serKey);
  const domain = toDomain(report.website);
  const source = report.country || settings.defaultCountry || 'us';
  const wantsLocal = report.services.includes('Local SEO');
  const wantsAi = report.services.some((s) => ['AI SEO', 'GEO', 'AEO'].includes(s));

  try {
    // -- 1. Our own crawl. Free, fast, and the source of AI-readiness signals.
    await setProgress(reportId, 8, STEPS[0]);
    const crawl = await safe('crawl', () => runTechnicalAudit(report.website, psKey), {});

    // -- 2. Search visibility. Parallel: independent endpoints, rate limiter serialises.
    await setProgress(reportId, 22, STEPS[1]);
    const [overview, history, keywords, striking, pages] = await Promise.all([
      safe('overview', () => se.getDomainOverview(domain, source)),
      safe('history', () => se.getDomainHistory(domain, source)),
      safe('keywords', () => se.getDomainKeywords(domain, source, { limit: 200 }), []),
      safe('striking', () => se.getStrikingDistance(domain, source, 30), []),
      safe('pages', () => se.getDomainPages(domain, source, 20), []),
    ]);
    credits += 500;

    const organic = (overview && overview.organic) || {};
    const kwList = Array.isArray(keywords) ? keywords : [];
    const page1 = (organic.top1_5 || 0) + (organic.top6_10 || 0);

    const keywordData = {
      totalKeywords: organic.keywords_count || kwList.length || 0,
      page1Keywords: page1,
      traffic: organic.traffic_sum || 0,
      trafficValue: organic.price_sum || 0,
      distribution: {
        top1_5: organic.top1_5 || 0,
        top6_10: organic.top6_10 || 0,
        top11_20: organic.top11_20 || 0,
        top21_50: organic.top21_50 || 0,
        top51_100: organic.top51_100 || 0,
      },
      topKeywords: kwList.slice(0, 25),
      strikingDistance: Array.isArray(striking) ? striking : [],
      topPages: Array.isArray(pages) ? pages : [],
      history: Array.isArray(history) ? history : [],
    };

    // -- 3. Backlinks + toxic split.
    await setProgress(reportId, 38, STEPS[2]);
    const [blSummary, refdomains, anchors] = await Promise.all([
      safe('backlinks', () => se.getBacklinkSummary(domain, 'domain')),
      safe('refdomains', () => se.getReferringDomains(domain, 'domain', 200), null),
      safe('anchors', () => se.getAnchors(domain, 'domain', 20), null),
    ]);
    credits += 300;

    const sum = (blSummary && blSummary.summary && blSummary.summary[0]) || {};
    const refs = (refdomains && refdomains.refdomains) || [];

    // Toxicity heuristic: DA under 10 is, in practice, PBN/classified junk.
    const toxic = refs.filter((r) => (r.domain_inlink_rank || 0) < 10).length;
    const quality = refs.filter((r) => (r.domain_inlink_rank || 0) >= 40).length;
    const neutral = refs.length - toxic - quality;

    const backlinks = {
      total: sum.backlinks || 0,
      referringDomains: sum.refdomains || refs.length || 0,
      domainAuthority: sum.domain_inlink_rank || 0,
      pageAuthority: sum.inlink_rank || 0,
      dofollow: sum.dofollow_backlinks || 0,
      nofollow: sum.nofollow_backlinks || 0,
      eduLinks: sum.edu_backlinks || 0,
      govLinks: sum.gov_backlinks || 0,
      quality,
      neutral: Math.max(0, neutral),
      toxic,
      sampled: refs.length,
      toxicPercentage: refs.length ? Math.round((toxic / refs.length) * 100) : 0,
      topAnchors: (anchors && anchors.anchors) || [],
      topPages: sum.top_pages_by_refdomains || [],
    };

    // -- 4. Competitors. The highest-converting page in the report.
    await setProgress(reportId, 52, STEPS[3]);
    const compRaw = await safe('competitors', () => se.getCompetitors(domain, source), []);
    credits += 100;

    const topComps = (Array.isArray(compRaw) ? compRaw : [])
      .filter((c) => c.domain && c.domain !== domain)
      .slice(0, 4);

    // Cheap metrics endpoint (10 credits) rather than full summary (100) per rival.
    const competitors = [];
    for (const c of topComps) {
      const m = await safe(`comp:${c.domain}`, () => se.getBacklinkMetrics(c.domain, 'domain'));
      const cm = (m && m.metrics && m.metrics[0]) || {};
      credits += 10;
      competitors.push({
        domain: c.domain,
        commonKeywords: c.common_keywords,
        totalKeywords: c.total_keywords,
        missingKeywords: c.missing_keywords,
        traffic: c.traffic_sum,
        trafficValue: c.price_sum,
        relevance: c.domain_relevance,
        backlinks: cm.backlinks || 0,
        referringDomains: cm.refdomains || 0,
        domainAuthority: cm.domain_inlink_rank || 0,
      });
    }

    // Keyword gap vs the single strongest rival.
    let keywordGap = [];
    if (competitors.length) {
      const gap = await safe('gap', () => se.getKeywordGap(domain, competitors[0].domain, source, 30), []);
      keywordGap = Array.isArray(gap) ? gap : [];
      credits += 100;
    }

    // -- 5. AI visibility. Runs when any AI service is selected — this is the hook.
    await setProgress(reportId, 66, STEPS[4]);
    let aiData = null;
    if (wantsAi || true) {
      // Always run it: it's the strongest differentiator even on a plain SEO pitch.
      const [aiGaps, aiWins] = await Promise.all([
        safe('aiGaps', () => se.getAiOverviewGaps(domain, source, 30), []),
        safe('aiWins', () => se.getAiOverviewWins(domain, source, 30), []),
      ]);
      credits += 200;

      const aiOverview = {
        gapCount: Array.isArray(aiGaps) ? aiGaps.length : 0,
        citedCount: Array.isArray(aiWins) ? aiWins.length : 0,
        gaps: (Array.isArray(aiGaps) ? aiGaps : []).slice(0, 10),
        wins: (Array.isArray(aiWins) ? aiWins : []).slice(0, 10),
      };

      aiData = await safe(
        'aiVisibility',
        () =>
          ai.runAiVisibility(claudeKey, {
            businessName: report.businessName,
            website: report.website,
            industry: (crawl.title || '') + ' — ' + (crawl.metaDescription || ''),
            location: report.location,
            services: report.services,
            crawl,
            aiOverview,
          }),
        null
      );
    }

    // -- 5b. Local SEO: Google Business Profile via Google Places (New).
    // Only runs when Local SEO is selected AND a Places key is configured.
    let localData = { enabled: wantsLocal };
    if (wantsLocal) {
      const placesKey = settings.getKey('googlePlaces');
      if (placesKey) {
        const gp = new GooglePlaces(placesKey);
        const profile = await safe(
          'googlePlaces',
          () =>
            gp.getBusinessProfile({
              businessName: report.businessName,
              location: report.location,
              website: report.website,
            }),
          { enabled: true, gbpFound: false }
        );
        localData = profile;

        // Summarise review sentiment with Claude, from the real reviews only.
        if (profile.gbpFound && profile.reviews && profile.reviews.length) {
          localData.reviewSummary = await safe(
            'reviewSummary',
            () =>
              ai.summariseReviews(claudeKey, {
                businessName: profile.name,
                rating: profile.rating,
                reviewCount: profile.reviewCount,
                reviews: profile.reviews,
              }),
            null
          );
        }
      } else {
        // Selected but no key: skip cleanly, flag why for the agent.
        localData = { enabled: true, gbpFound: false, skippedNoKey: true };
      }
    }

    // -- 6. Score everything, then let Claude write from the real numbers.
    await setProgress(reportId, 80, STEPS[5]);

    const technical = scoring.scoreTechnical(crawl);
    const onPage = scoring.scoreOnPage(crawl);
    const content = scoring.scoreContent(crawl, keywordData);
    const authority = scoring.scoreAuthority(backlinks, competitors);
    const local = scoring.scoreLocal(localData);
    const aiScore = scoring.scoreAiVisibility(aiData);

    const scores = { technical, onPage, content, authority, local, aiVisibility: aiScore };
    const overall = scoring.calculateOverall(scores);

    const allIssues = [
      ...technical.issues, ...onPage.issues, ...content.issues,
      ...authority.issues, ...local.issues, ...aiScore.issues,
    ];
    const roadmap = scoring.buildRoadmap(allIssues, report.services);
    const opportunity = scoring.calculateOpportunityValue(kwList);

    const topIssue =
      allIssues.find((i) => i.severity === 'critical') || allIssues[0] || { title: 'None found' };

    const headline = await safe(
      'tagline',
      () =>
        ai.generateTagline(claudeKey, {
          businessName: report.businessName,
          industry: crawl.title || '',
          website: report.website,
          audience: crawl.metaDescription || '',
          domainAuthority: backlinks.domainAuthority,
          competitorAuthority: authority.competitorAverage,
          page1Keywords: keywordData.page1Keywords,
          traffic: keywordData.traffic,
          aiShareOfVoice: aiData ? aiData.shareOfVoice : 0,
          topIssue: topIssue.title,
          competitors: competitors.map((c) => c.domain),
        }),
      {
        headlineBold: 'Your customers are searching.',
        headlineLight: 'They are finding someone else.',
        headline: 'Your customers are searching. They are finding someone else.',
        subhead: `A search visibility analysis for ${report.businessName}.`,
      }
    );

    const summary = await safe(
      'summary',
      () =>
        ai.generateExecutiveSummary(claudeKey, {
          businessName: report.businessName,
          website: report.website,
          scores: { overall, technical: technical.score, onPage: onPage.score, content: content.score, authority: authority.score, ai: aiScore.score },
          keywords: { total: keywordData.totalKeywords, page1: keywordData.page1Keywords, traffic: keywordData.traffic },
          backlinks: { da: backlinks.domainAuthority, refdomains: backlinks.referringDomains, toxicPct: backlinks.toxicPercentage },
          competitors: competitors.map((c) => ({ domain: c.domain, da: c.domainAuthority, traffic: c.traffic })),
          aiShareOfVoice: aiData ? aiData.shareOfVoice : null,
          opportunity,
          criticalIssues: allIssues.filter((i) => i.severity === 'critical').map((i) => i.title),
        }),
      null
    );

    // -- 7. Render.
    await setProgress(reportId, 90, STEPS[6]);

    const payload = {
      report: {
        id: String(report.id),
        website: report.website,
        domain,
        businessName: report.businessName,
        customerName: report.customerName,
        services: report.services,
        country: source,
        location: report.location,
        agentName: report.agentName,
        agentPhone: report.agentPhone,
        agentEmail: report.agentEmail,
        agentDesignation: report.agentDesignation,
        date: new Date(),
        validDays: settings.reportValidDays,
      },
      pricing: settings.pricing ? JSON.parse(JSON.stringify(settings.pricing)) : { enabled: false },
      settings: {
        companyName: settings.companyName,
        companyShort: settings.companyShort,
        logoPath: settings.logoPath,
        website: settings.website,
        email: settings.email,
        phone: settings.phone,
        colors: settings.colors,
      },
      headline,
      summary,
      scores: {
        overall,
        grade: scoring.grade(overall),
        technical: technical.score,
        onPage: onPage.score,
        content: content.score,
        authority: authority.score,
        local: local.score,
        aiVisibility: aiScore.score,
      },
      crawl,
      keywordData,
      backlinks,
      competitors,
      keywordGap,
      ai: aiData,
      local: localData,
      opportunity,
      roadmap,
      issues: allIssues,
      issueCounts: {
        critical: allIssues.filter((i) => i.severity === 'critical').length,
        warning: allIssues.filter((i) => i.severity === 'warning').length,
        notice: allIssues.filter((i) => i.severity === 'notice').length,
        total: allIssues.length,
      },
    };

    const { pdfPath, htmlPath } = await renderReport(payload);

    await Report.update({
      status: 'complete',
      progress: 100,
      currentStep: 'Done',
      scores: payload.scores,
      headline,
      summary,
      data: payload,
      opportunityValue: opportunity,
      pdfPath,
      htmlPath,
      creditsUsed: credits,
      durationMs: Date.now() - started,
      completedAt: new Date(),
    }, { where: { id: reportId } });

    return { ok: true, pdfPath, credits };
  } catch (err) {
    console.error('[audit] fatal:', err);
    await Report.update({
      status: 'failed',
      error: err.message,
      currentStep: 'Failed',
      durationMs: Date.now() - started,
      creditsUsed: credits,
    }, { where: { id: reportId } });
    throw err;
  }
}

module.exports = { runReport, STEPS };
