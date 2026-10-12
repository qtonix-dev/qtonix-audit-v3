/**
 * Report renderer: Handlebars -> HTML -> Chromium -> PDF.
 *
 * Established pattern (do not "simplify" these):
 *   - file:// URI, not setContent, so local font @font-face resolves
 *   - waitForTimeout(800) to let conic-gradient dials paint
 *   - printBackground: true, all margins '0' for the bleed cover
 *   - fonts installed to ~/.fonts + fc-cache; the Google Fonts CDN is
 *     unreachable from headless Chromium here
 */

const fs = require('fs/promises');
const path = require('path');
const Handlebars = require('handlebars');

const OUT_DIR = process.env.REPORT_DIR || path.join(__dirname, '../../storage/reports');
const FONT_DIR = process.env.FONT_DIR || path.join(process.env.HOME || '/home/claude', '.fonts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
Handlebars.registerHelper('formatNum', (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('en-US');
});

Handlebars.registerHelper('currency', (n) => {
  const v = Number(n) || 0;
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'K';
  return '$' + Math.round(v);
});

Handlebars.registerHelper('formatDate', (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
);

Handlebars.registerHelper('upper', (s) => String(s || '').toUpperCase());
Handlebars.registerHelper('lower', (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, ''));
Handlebars.registerHelper('inc', (i) => Number(i) + 1);
Handlebars.registerHelper('firstLetter', (s) => String(s || '?').trim().charAt(0).toUpperCase());
Handlebars.registerHelper('join', (arr, sep) => Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : '');
// Split an array into two halves; side 0 = first half, side 1 = second half.
Handlebars.registerHelper('half', (arr, side) => {
  const a = Array.isArray(arr) ? arr : [];
  const mid = Math.ceil(a.length / 2);
  return Number(side) === 0 ? a.slice(0, mid) : a.slice(mid);
});
Handlebars.registerHelper('seconds', (ms) => ((Number(ms) || 0) / 1000).toFixed(1));

/** Colour a stat by thresholds: below `bad` is red, above `good` is green. */
Handlebars.registerHelper('toneFor', (value, bad, good) => {
  const v = Number(value);
  if (!isFinite(v)) return 'ink';
  if (v < Number(bad)) return 'bad';
  if (v < Number(good)) return 'warn';
  return 'good';
});

Handlebars.registerHelper('lcpTone', (ms) => {
  const v = Number(ms) || 0;
  if (v > 4000) return 'bad';
  if (v > 2500) return 'warn';
  return 'good';
});

/** Score -> colour, matching the reference's red/amber/green thresholds. */
Handlebars.registerHelper('scoreColor', (score) => {
  const v = Number(score) || 0;
  return v >= 70 ? '#16A34A' : v >= 45 ? '#E58A24' : '#E5484D';
});

Handlebars.registerHelper('formatMonth', (d) =>
  new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
);

Handlebars.registerHelper('severityClass', (s) =>
  s === 'critical' ? 'b-crit' : s === 'warning' ? 'b-warn' : 'b-note'
);

/**
 * SVG ring fill. Returns "<filled> <remainder>" for stroke-dasharray.
 * Used instead of conic-gradient, which several PDF engines render as a flat
 * circle with no warning.
 */
Handlebars.registerHelper('between', (v, lo, hi) => Number(v) >= Number(lo) && Number(v) <= Number(hi));
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('gt', (a, b) => Number(a) > Number(b));
Handlebars.registerHelper('lt', (a, b) => Number(a) < Number(b));
Handlebars.registerHelper('bandColor', (band) => (band === 'strong' ? '#16A34A' : band === 'partial' ? '#E58A24' : '#E5484D'));
Handlebars.registerHelper('ringDash', (pct, radius) => {
  const c = 2 * Math.PI * Number(radius);
  const filled = (Math.max(0, Math.min(100, Number(pct) || 0)) / 100) * c;
  return `${filled.toFixed(2)} ${(c - filled).toFixed(2)}`;
});

const dialColor = (score) =>
  score >= 70 ? '#16A34A' : score >= 45 ? '#F59E0B' : '#DC2626';

/**
 * Shape the raw payload into exactly what the template needs.
 * Doing this here keeps the template dumb and the logic testable.
 */
function buildViewModel(p, opts = {}) {
  const vm = { ...p };

  // Fonts differ by target. WeasyPrint (PDF) reads local TTFs via file://.
  // A browser cannot load file:// fonts, so the HTML view must pull them from
  // a web source, or the page renders unstyled/broken. `forWeb` picks the right one.
  vm.forWeb = !!opts.forWeb;

  // True only when at least one PageSpeed strategy returned a real score,
  // so the template can skip the whole section when the key wasn't configured.
  const ps = p.crawl && p.crawl.pageSpeed;
  vm.hasPageSpeed = !!(ps && ((ps.desktop && ps.desktop.performance != null) || (ps.mobile && ps.mobile.performance != null)));

  // SMO: friendly network list with found/not-found, for the social section.
  if (p.socialAssessment) {
    const social = p.social || {};
    const nets = [
      ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'],
      ['twitter', 'X / Twitter'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'],
    ];
    vm.socialList = nets.map(([k, label]) => ({ label, found: !!social[k], url: social[k] || null }));
  }
  vm.fontDir = 'file://' + FONT_DIR;

  // --- dials, each with a plain-English verdict for the scorecard table
  const verdictFor = (name, s) => {
    if (s == null) return '';
    const bad = s < 45, mid = s < 70;
    const map = {
      'Technical': bad ? 'Speed and crawl problems are actively losing you visitors.' : mid ? 'Functional, but there is measurable headroom.' : 'Solid technical foundation.',
      'On-Page': bad ? 'Pages are not built to rank for the searches your buyers make.' : mid ? 'Basics are there; targeting needs sharpening.' : 'Well-structured and correctly targeted.',
      'Content': bad ? 'Too thin to compete for anything valuable.' : mid ? 'Reasonable base, not yet enough depth to win.' : 'Strong, competitive content depth.',
      'Authority': bad ? 'Almost no trust signal — the main brake on your rankings.' : mid ? 'Enough for long-tail, not for money terms.' : 'Genuine authority in your space.',
      'AI Visibility': bad ? 'Effectively invisible to AI assistants and AI Overviews.' : mid ? 'Occasionally surfaced, inconsistently.' : 'Well understood by AI systems.',
      'Local SEO': bad ? 'Missing from the map pack where local buyers decide.' : mid ? 'Present but under-optimised.' : 'Strong local presence.',
    };
    return map[name] || '';
  };

  const dialDefs = [
    ['Technical', p.scores.technical],
    ['On-Page', p.scores.onPage],
    ['Content', p.scores.content],
    ['Authority', p.scores.authority],
    ['AI Visibility', p.scores.aiVisibility],
    ['Local SEO', p.scores.local],
  ];
  vm.dials = dialDefs
    .filter(([, s]) => s != null)
    .map(([name, score]) => ({ name, score, color: dialColor(score), verdict: verdictFor(name, score) }));

  // --- competitor average DA (used on the cover stat)
  vm.competitorAvgDA = p.competitors && p.competitors.length
    ? Math.round(p.competitors.reduce((s, c) => s + (c.domainAuthority || 0), 0) / p.competitors.length)
    : 0;

  // --- issue table: show the worst, count the rest. Truncation IS the upsell.
  const sorted = [...(p.issues || [])].sort((a, b) => {
    const rank = { critical: 0, warning: 1, notice: 2 };
    return rank[a.severity] - rank[b.severity];
  });
  vm.topIssues = sorted.slice(0, 8);
  vm.moreIssues = Math.max(0, sorted.length - 8);

  // --- traffic comparison bars (log-ish scale so a 40 vs 180k chart still reads)
  const you = { label: `${p.report.domain} (YOU)`, value: p.keywordData.traffic || 0, isYou: true };
  const them = (p.competitors || []).map((c) => ({ label: c.domain, value: c.traffic || 0, isYou: false }));
  const all = [you, ...them].sort((a, b) => a.value - b.value);
  const max = Math.max(...all.map((x) => x.value), 1);
  vm.trafficBars = all.map((x) => ({
    ...x,
    pct: Math.max(3, Math.round((Math.log10(x.value + 1) / Math.log10(max + 1)) * 100)),
  }));

  // --- backlink donut percentages
  const sampled = p.backlinks.sampled || 1;
  vm.backlinks = {
    ...p.backlinks,
    qualityPct: Math.round((p.backlinks.quality / sampled) * 100),
    neutralPct: Math.round((p.backlinks.neutral / sampled) * 100),
    toxicPct: Math.round((p.backlinks.toxic / sampled) * 100),
  };

  // --- donut arcs: each segment is a full-circumference stroke, dash-offset
  //     so only its slice shows. Cumulative offset walks around the circle.
  const R = 55;
  const CIRC = 2 * Math.PI * R;
  const segs = [
    { value: p.backlinks.quality, color: p.settings.colors.blue },
    { value: p.backlinks.neutral, color: '#CBD5E1' },
    { value: p.backlinks.toxic, color: '#DC2626' },
  ];
  let acc = 0;
  vm.donutArcs = segs
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = s.value / sampled;
      const len = frac * CIRC;
      const arc = { color: s.color, dash: `${len.toFixed(2)} ${(CIRC - len).toFixed(2)}`, offset: (-acc).toFixed(2) };
      acc += len;
      return arc;
    });

  // --- striking distance with the money attached
  const { ctrFor } = require('./scoring');
  vm.strikingTop = (p.keywordData.strikingDistance || []).slice(0, 8).map((k) => {
    const vol = Number(k.volume) || 0;
    const cpc = Number(k.cpc) || 0;
    const gain = Math.round((vol * ctrFor(3) - vol * ctrFor(Number(k.position) || 15)) * cpc);
    // Target is deliberately conservative: top-6, not #1. Promising #1 on a
    // free audit is how agencies lose trust at the second meeting.
    return { ...k, gain: Math.max(gain, 0), target: Math.max(3, Math.min(6, Math.round((Number(k.position) || 15) / 3))) };
  });

  vm.keywordGapTop = (p.keywordGap || []).slice(0, 8);

  // --- Estimated traffic VALUE ($): what the client's organic traffic would
  //     cost in Google Ads. The single most persuasive number for an owner.
  vm.trafficValueTotal = Math.round(p.keywordData.trafficValue || 0);
  // Combined competitor traffic value they're capturing (the "money on the table").
  vm.competitorValueSum = Math.round(
    (p.competitors || []).reduce((s, c) => s + (Number(c.trafficValue) || 0), 0)
  );

  // --- Top-performing pages (which URLs actually earn the traffic).
  vm.topPagesTop = (p.keywordData.topPages || []).slice(0, 6).map((pg) => ({
    url: pg.url,
    title: pg.title || pg.url,
    keywords: Number(pg.keywords_count) || 0,
    traffic: Number(pg.traffic_sum) || 0,
    value: Math.round(Number(pg.price_sum) || 0),
  }));

  // --- Search-intent mix across the ranking keywords. Shows how much traffic is
  //     buyer-intent (Commercial/Transactional) vs. informational.
  const intentMap = { I: 0, N: 0, C: 0, T: 0, L: 0 };
  (p.keywordData.topKeywords || []).forEach((k) => {
    (Array.isArray(k.intents) ? k.intents : []).forEach((code) => {
      const c = String(code).charAt(0).toUpperCase();
      if (c in intentMap) intentMap[c] += 1;
    });
  });
  const intentTotal = Object.values(intentMap).reduce((a, b) => a + b, 0) || 1;
  const intentMeta = {
    C: { label: 'Commercial', color: p.settings.colors.orangeDeep || '#FF4500' },
    T: { label: 'Transactional', color: p.settings.colors.blue || '#2563EB' },
    I: { label: 'Informational', color: '#94A3B8' },
    N: { label: 'Navigational', color: '#CBD5E1' },
    L: { label: 'Local', color: '#F5A524' },
  };
  vm.intentMix = ['C', 'T', 'I', 'N', 'L']
    .filter((c) => intentMap[c] > 0)
    .map((c) => ({ code: c, label: intentMeta[c].label, color: intentMeta[c].color, count: intentMap[c], pct: Math.round((intentMap[c] / intentTotal) * 100) }));
  vm.buyerIntentPct = Math.round(((intentMap.C + intentMap.T) / intentTotal) * 100);

  // --- AI Overview (SGE) citation gap — modern GEO/AEO differentiator.
  if (p.aiOverview && (p.aiOverview.gapCount || p.aiOverview.citedCount)) {
    vm.aiOverview = {
      gapCount: p.aiOverview.gapCount || 0,
      citedCount: p.aiOverview.citedCount || 0,
      gaps: (p.aiOverview.gaps || []).slice(0, 8).map((g) => ({
        keyword: g.keyword, volume: Number(g.volume) || 0, position: g.position || '—',
      })),
    };
  }

  // --- Traffic/keyword trend (last few months) — is the site growing or sliding?
  const hist = Array.isArray(p.keywordData.history) ? p.keywordData.history : [];
  if (hist.length >= 2) {
    const pts = hist.slice(-6).map((h) => ({
      label: `${String(h.month).padStart(2, '0')}/${String(h.year).slice(-2)}`,
      traffic: Number(h.traffic_sum) || 0,
    }));
    const maxT = Math.max(...pts.map((x) => x.traffic), 1);
    const first = pts[0].traffic || 0;
    const last = pts[pts.length - 1].traffic || 0;
    vm.trafficTrend = {
      points: pts.map((x, i) => ({ ...x, h: Math.max(4, Math.round((x.traffic / maxT) * 100)), i })),
      direction: last > first * 1.05 ? 'up' : last < first * 0.95 ? 'down' : 'flat',
      changePct: first ? Math.round(((last - first) / first) * 100) : 0,
    };
  }

  // --- h2 split: black statement, then blue clause (matches reference)
  vm.summary = { ...(p.summary || {}) };
  if (!vm.summary.headA) {
    vm.summary.headA = 'The business is sound.';
    vm.summary.headB = 'The problem is nobody can find it in search.';
  }
  if (!vm.summary.diagnosis) {
    const crit = (p.issues || []).filter((i) => i.severity === 'critical').slice(0, 2).map((i) => i.title.toLowerCase());
    vm.summary.diagnosis = crit.length
      ? `Two things cause that, and both are fixable: ${crit.join(', and ')}. We present the evidence plainly and let it speak for itself.`
      : 'We present the evidence plainly and let it speak for itself.';
  }

  // --- problem/after columns, generated from actual issues. Two different
  // issues can map to the same "after" outcome (e.g. two speed issues, or two
  // that hit the default), which produced duplicate lines like "A fast site
  // that holds visitors…" twice. Dedupe the outcomes so each appears once.
  vm.problemsToday = sorted.slice(0, 6).map((i) => i.title);
  const outcomeFor = (title) => {
    const t = String(title).toLowerCase();
    if (t.includes('speed') || t.includes('wait')) return 'A fast site that holds visitors instead of losing them.';
    if (t.includes('schema') || t.includes('structured')) return 'Full structured data so Google and AI know exactly who you are.';
    if (t.includes('authority') || t.includes('domain authority')) return 'Genuine, relevant authority built steadily and safely.';
    if (t.includes('spam') || t.includes('toxic')) return 'Spam links audited and disavowed; a clean, stable domain.';
    if (t.includes('ai') || t.includes('assistant')) return 'A presence AI assistants can find, trust and recommend.';
    if (t.includes('keyword') || t.includes('page 1')) return 'Dedicated pages targeting the exact searches your buyers make.';
    if (t.includes('alt') || t.includes('meta') || t.includes('title') || t.includes('h1'))
      return 'Every page correctly titled and described for the searches that matter.';
    return 'Resolved, verified, and monitored monthly.';
  };
  const seenOutcome = new Set();
  vm.afterFix = [];
  for (const i of sorted) {
    const line = outcomeFor(i.title);
    if (seenOutcome.has(line)) continue;
    seenOutcome.add(line);
    vm.afterFix.push(line);
    if (vm.afterFix.length >= 5) break;
  }
  vm.problemsToday = vm.problemsToday.slice(0, 5);

  // --- AI verdict line
  if (p.ai) {
    vm.aiVerdict =
      p.ai.shareOfVoice === 0
        ? `Across ${p.ai.promptsTested} buying questions in your category, AI assistants recommended your competitors and never once named ${p.report.businessName}.`
        : `You were named in ${p.ai.mentions} of ${p.ai.promptsTested} buying questions. Your competitors were named in the rest.`;
  }

  // --- KPI targets, anchored to where they actually are today
  const traffic = p.keywordData.traffic || 0;
  const da = p.backlinks.domainAuthority || 0;
  vm.kpis = [
    { label: 'Targeted traffic', from: `${traffic}/mo`, to: `${Math.max(Math.round(traffic * 4), 500)}+/mo`, pct: 72 },
    { label: 'Page-1 keywords', from: String(p.keywordData.page1Keywords || 0), to: `${Math.max((p.keywordData.page1Keywords || 0) + 40, 40)}+`, pct: 65 },
    { label: 'Domain Authority', from: String(da), to: `${da + 15}+`, pct: 58 },
    { label: 'AI share of voice', from: `${p.ai ? p.ai.shareOfVoice : 0}%`, to: '40%+', pct: 60 },
    { label: 'Spam backlinks', from: `${p.backlinks.toxic || 0}`, to: 'Disavowed', pct: 85 },
    { label: 'Site health', from: `${p.scores.overall}/100`, to: '85+/100', pct: 78 },
  ];

  // --- contents page: only list sections we actually rendered
  const tocItems = [
    'The Situation',
    'The Visibility Gap',
    'The Problem & The Transformation',
    'Health Scorecard',
  ];
  if (p.competitors && p.competitors.length) tocItems.push('Competitor & Backlink Analysis');
  if (p.keywordData && (p.keywordData.topPages || []).length) tocItems.push('Top Pages & Search Intent');
  if (vm.hasPageSpeed) tocItems.push('Google PageSpeed Insights');
  if (p.socialAssessment) tocItems.push('Social Media (SMO)');
  if (p.local && (p.local.gbpFound || p.local.enabled)) tocItems.push('Google Maps & Local SEO');
  if (p.ai) tocItems.push('AI Search Visibility — GEO / AEO');
  if (p.ai && p.ai.aiBreakdown && p.ai.aiBreakdown.length) tocItems.push('AI Readiness — The Five Signals');
  tocItems.push('The Strategy');
  tocItems.push('The Fix, Measured — KPIs');
  if (p.pricing && p.pricing.enabled) tocItems.push('Your Investment');
  tocItems.push("Let's Begin");
  // Number every entry sequentially so inserted sections keep the running order.
  vm.toc = tocItems.map((t, i) => ({ n: String(i + 1).padStart(2, '0'), t }));

  // --- "what we researched" table, from real crawl + report inputs
  vm.research = [
    { k: 'Industry', v: (p.crawl.title || p.report.businessName) + (p.crawl.metaDescription ? ` — ${p.crawl.metaDescription.slice(0, 60)}` : '') },
    { k: 'Website', v: `${p.report.domain} · ${p.crawl.https ? 'HTTPS secure' : 'NOT SECURE'} · ${(p.crawl.wordCount || 0).toLocaleString()} words` },
    { k: 'Services to market', v: (p.report.services || []).join(', ') },
    { k: 'Target market', v: (p.report.location ? p.report.location + ' · ' : '') + String(p.report.country || '').toUpperCase() },
    { k: 'Competitors', v: (p.competitors || []).map((c) => c.domain).slice(0, 5).join(', ') || 'None identified' },
    { k: 'Pain points', v: (p.issues || []).filter((i) => i.severity === 'critical').slice(0, 3).map((i) => i.title).join('; ') || 'None critical' },
  ];

  // --- growth headline stats
  const mult = traffic > 0 ? Math.max(Math.round((traffic * 4) / traffic), 4) : 20;
  // NOTE: do NOT insert U+2060 word-joiners here to prevent wrapping.
  // It crashes fontTools during font subsetting. Wrapping is handled purely by
  // `white-space:nowrap` on .stat-v / .kpi-v, which is the correct layer for it.
  vm.growth = {
    lift: '20–30%',
    multiple: traffic > 0 ? `${mult}x` : '20x',
  };

  // --- narrative copy, derived from the data (never invented)
  const avgDA = vm.competitorAvgDA;
  vm.visibility = {
    intro: `Your buyers search for these terms every day. Right now ${p.report.domain} ranks for ${(p.keywordData.totalKeywords || 0).toLocaleString()} keywords but holds ${p.keywordData.page1Keywords || 0} first-page positions, while established competitors capture tens of thousands of visits a month. This isn't about the quality of what you sell — it's authority and page structure, both of which we build.`,
    quote:
      (p.keywordData.page1Keywords || 0) === 0
        ? 'You have zero keywords on page one today. From a base this low, disciplined SEO tends to show early, visible movement — there is a lot of room to climb.'
        : `You hold ${p.keywordData.page1Keywords} page-one positions against a category that supports far more. The room to climb is the opportunity.`,
  };

  // Competitor framing must be HONEST — never claim the client is behind when
  // the data says otherwise, or the whole report loses credibility. We compare
  // real numbers and only call something a gap when it genuinely is one, while
  // still appreciating strengths and offering how we help either way.
  const topRival = (p.competitors && p.competitors[0]) || null;
  const rivalKw = (topRival && topRival.totalKeywords) || 0;
  const myPage1 = p.keywordData.page1Keywords || 0;
  const daAhead = da > avgDA;                 // client's authority beats rivals
  vm.daAhead = daAhead;
  const daClose = !daAhead && da >= avgDA - 5; // roughly level
  const rivalNames = (p.competitors || []).slice(0, 3).map((c) => c.domain).filter(Boolean);

  // Intro adapts to reality rather than always saying "they outrank you".
  if (!p.competitors || !p.competitors.length) {
    vm.competitorIntro = `We benchmarked ${p.report.businessName} against the field. Your job now is to convert your real-world credibility into search visibility — on a clean, trusted domain.`;
  } else if (daAhead) {
    vm.competitorIntro = `Good news: your domain authority (${da}) is actually ahead of ${rivalNames.join(', ')} (avg ${avgDA}). That's a genuine asset. The gap isn't trust — it's coverage: they rank for more searches because they have more dedicated pages. That's very fixable, and your stronger domain means results should come faster.`;
  } else if (daClose) {
    vm.competitorIntro = `You're roughly level with ${rivalNames.join(', ')} on domain authority (${da} vs. ${avgDA}). This is a winnable race — it comes down to who builds the right pages and coverage first.`;
  } else {
    vm.competitorIntro = `${rivalNames.join(', ')} currently outrank you largely because they've built more authority over time and have dedicated pages for each need. Your advantage is the business itself. We turn that into rankings — on a clean, trusted domain.`;
  }

  // "Where you're losing" — only include a line when it's genuinely a gap.
  vm.losing = [];
  if (!daAhead && !daClose) vm.losing.push(`Domain Authority ${da} vs. competitors at ${avgDA} — a real trust gap to close.`);
  else if (daClose) vm.losing.push(`Domain Authority ${da} vs. competitors at ${avgDA} — level, but not yet ahead enough to dominate.`);
  if (p.backlinks.toxic) vm.losing.push(`${p.backlinks.toxicPercentage}% of your linking sites are spam or low-quality junk.`);
  if (rivalKw > 0) vm.losing.push(`${myPage1} first-page rankings against ${rivalKw.toLocaleString()} keywords for your top rival — a coverage gap.`);
  if ((p.crawl.wordCount || 0) < 600) vm.losing.push(`Homepage is only ${p.crawl.wordCount || 0} words — too thin to rank for much.`);
  else vm.losing.push('Few dedicated pages for high-intent searches — most rivals have more.');
  // Never show an empty column; if the site is strong across the board, say so.
  if (!vm.losing.length) vm.losing.push('No major structural gaps — the opportunity here is acceleration, not repair.');

  // "What's already strong" — genuinely appreciate what's good.
  vm.winning = [];
  if (daAhead) vm.winning.push(`Your domain authority (${da}) already beats the competitor average (${avgDA}) — a real head start.`);
  if (!p.backlinks.toxic) vm.winning.push('A clean backlink profile with little or no toxic link risk.');
  if ((p.backlinks.referringDomains || 0) > 0) vm.winning.push(`${(p.backlinks.referringDomains || 0).toLocaleString()} referring domains already pointing to you.`);
  if (myPage1 > 0) vm.winning.push(`${myPage1} keyword${myPage1 === 1 ? '' : 's'} already on page one to build from.`);
  if ((p.crawl.wordCount || 0) >= 600) vm.winning.push('Enough on-page content to give search engines something to rank.');
  // Always end with how we help, so a strong site still has a clear next step.
  vm.winning.push(daAhead
    ? 'We convert your authority lead into rankings by building the pages and coverage your rivals use to win.'
    : 'We build genuine, relevant authority and the dedicated pages your buyers actually search for.');

  vm.onboarding = [
    { t: 'Confirm your package', d: `Reply to let us know which plan fits — we recommend Growth for ${p.report.businessName}.` },
    { t: 'Kickoff within 24 hours', d: 'We set up your dedicated group chat and send a short onboarding checklist.' },
    { t: 'Access handover', d: 'You grant access to your site, Search Console and Analytics so we work with real data.' },
    { t: 'Work begins', d: 'Technical fixes, backlink cleanup and the first high-intent pages go live in week one.' },
    { t: 'First report', d: 'Your first report lands within days — and every week after.' },
  ];

  return vm;
}

async function renderHtml(payload, opts = {}) {
  const tplSrc = await fs.readFile(path.join(__dirname, '../templates/report.hbs'), 'utf8');
  const tpl = Handlebars.compile(tplSrc);
  return tpl(buildViewModel(payload, opts));
}

async function renderReport(payload) {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const slug = `${payload.report.domain.replace(/[^a-z0-9]/gi, '-')}-${payload.report.id}`;
  const htmlPath = path.join(OUT_DIR, `${slug}.html`);
  const pdfPath = path.join(OUT_DIR, `${slug}.pdf`);

  // The on-disk HTML is what the browser "view" serves → use web fonts.
  const htmlForWeb = await renderHtml(payload, { forWeb: true });
  await fs.writeFile(htmlPath, htmlForWeb, 'utf8');

  // The PDF is rendered from a separate file:// font build so WeasyPrint
  // embeds the exact brand fonts.
  const htmlForPdf = await renderHtml(payload, { forWeb: false });
  const pdfHtmlPath = path.join(OUT_DIR, `${slug}.pdf.html`);
  await fs.writeFile(pdfHtmlPath, htmlForPdf, 'utf8');

  // WeasyPrint, not Chromium. The reference proposal was produced with
  // WeasyPrint 69, and it is the only engine that honours the @page
  // named-page rules (running footers, per-page margins) this design needs.
  // Chromium ignores @page :nth and named pages entirely.
  //
  // Invoke via `python3 -m weasyprint` rather than the bare `weasyprint`
  // binary: pip may install the console script outside the runtime PATH
  // (a common cause of "PDF not ready" in containers), but the module form
  // always resolves when the package is installed.
  await new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    execFile(
      'python3',
      ['-m', 'weasyprint', '-e', 'utf-8', '-u', path.dirname(pdfHtmlPath), pdfHtmlPath, pdfPath],
      { timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`WeasyPrint failed: ${stderr || err.message}`));
        resolve();
      }
    );
  });

  return { pdfPath, htmlPath };
}

// ---- Pre-SEO Audit report: separate template, same WeasyPrint pipeline ------
async function renderPreSeoHtml(data, opts = {}) {
  const tplSrc = await fs.readFile(path.join(__dirname, '../templates/preSeoReport.hbs'), 'utf8');
  const tpl = Handlebars.compile(tplSrc);
  // forWeb → use web fonts (browser preview). showPlaceholders → render the
  // orange "[ PASTE SCREENSHOT HERE ]" prompt (only in the pre-generate review
  // preview; the FINAL report preview and the PDF never show it).
  return tpl({ ...data, forWeb: !!opts.forWeb, showPlaceholders: !!opts.showPlaceholders, fontDir: 'file://' + FONT_DIR });
}

async function renderPreSeo(data, slugBase) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const slug = `preseo-${String(slugBase || (data.report && data.report.domain) || 'report').replace(/[^a-z0-9]/gi, '-')}`;
  const htmlPath = path.join(OUT_DIR, `${slug}.html`);
  const pdfPath = path.join(OUT_DIR, `${slug}.pdf`);
  await fs.writeFile(htmlPath, await renderPreSeoHtml(data, { forWeb: true }), 'utf8');
  const pdfHtmlPath = path.join(OUT_DIR, `${slug}.pdf.html`);
  await fs.writeFile(pdfHtmlPath, await renderPreSeoHtml(data, { forWeb: false }), 'utf8');
  await new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    execFile('python3', ['-m', 'weasyprint', '-e', 'utf-8', '-u', path.dirname(pdfHtmlPath), pdfHtmlPath, pdfPath], { timeout: 120000 },
      (err, stdout, stderr) => err ? reject(new Error(`WeasyPrint failed: ${stderr || err.message}`)) : resolve());
  });

  // Durable storage: push the PDF and the self-contained HTML to ImageKit so
  // View/Download/public links keep working after Railway recycles local disk.
  let pdfUrl = null, htmlUrl = null, pdfFileId = null, htmlFileId = null;
  try {
    const ik = require('./imagekit');
    const { Settings } = require('../models');
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (ik.isConfigured(settings)) {
      // The HTML we store for the web view must be self-contained (web fonts,
      // no local file:// refs) so it renders anywhere, not just on this box.
      const webHtml = await renderPreSeoHtml(data, { forWeb: true });
      const [pr, hr] = await Promise.all([
        fs.readFile(pdfPath).then((buf) => ik.uploadFile({ base64: buf.toString('base64'), fileName: `${slug}.pdf`, folder: '/qtonix/preseo/reports' })),
        ik.uploadFile({ base64: Buffer.from(webHtml, 'utf8').toString('base64'), fileName: `${slug}.html`, folder: '/qtonix/preseo/reports' }),
      ]);
      pdfUrl = pr.url; pdfFileId = pr.fileId || null;
      htmlUrl = hr.url; htmlFileId = hr.fileId || null;
    }
  } catch (e) { console.error('[renderPreSeo] ImageKit upload failed, keeping local only:', e.message); }

  return { pdfPath, htmlPath, pdfUrl, htmlUrl, pdfFileId, htmlFileId };
}

// ---------------------------------------------------------------------------
// Brand Guideline renderer (landscape slide deck, Raleway, site-derived palette)
// ---------------------------------------------------------------------------
const BG_ASSET_DIR = process.env.BG_ASSET_DIR || path.join(__dirname, '../assets/fonts');

// Shade a hex colour darker by a factor (0..1) for the "deep" brand accent.
function shade(hex, factor = 0.78) {
  const h = String(hex || '#E55B2A').replace('#', '');
  if (h.length !== 6) return '#B4461E';
  const [r, g, b] = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * factor));
  return '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
}

// ---- Small colour toolkit for brand-driven theming (keeps text readable) ----
const _rgb = (hex) => { const h = String(hex || '').replace('#', ''); if (h.length !== 6) return null; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const _hex = (rgb) => '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
// Relative luminance 0..1 (perceptual-ish).
function lum(hex) { const c = _rgb(hex); if (!c) return 0; const [r, g, b] = c.map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
// Mix two hex colours by t (0 = a, 1 = b).
function mix(a, b, t) { const A = _rgb(a) || [0, 0, 0], B = _rgb(b) || [255, 255, 255]; return _hex(A.map((v, i) => v + (B[i] - v) * t)); }
// Lighten / darken toward white / black.
const lighten = (hex, t) => mix(hex, '#ffffff', t);
const darken = (hex, t) => mix(hex, '#000000', t);
// Pick black or white text for best contrast on a background.
const textOn = (bg) => (lum(bg) > 0.55 ? '#1a1a1a' : '#ffffff');
// Saturation 0..1.
function sat(hex) { const c = _rgb(hex); if (!c) return 0; const [r, g, b] = c.map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }

// A promo/marketing banner (text baked into the image, e.g. "ONE TRIP OUT" over
// a product) reads badly as a full-bleed cover — the baked text fights the
// headline. Heuristic: og:image is very often the marketing banner. We keep it
// for the captioned "stand for" slide but keep it OUT of the cover/grids.
function looksLikeBanner(img) {
  if (!img) return false;
  const a = String(img.alt || '').toLowerCase();
  const u = String(img.url || '').toLowerCase();
  return img.kind === 'og'
    || /banner|promo|ad[-_]|hero[-_]?banner|cover|marketing|offer|sale/.test(u)
    || /\b(sale|off|% off|shop now|buy|offer|free shipping)\b/.test(a);
}

// Prepare the view model: attach CSS-safe colour vars + per-swatch hexCss.
function bgViewModel(data) {
  const pal = (data.palette || []).map((c) => ({ ...c, hexCss: c.hex }));
  const brand = (pal.find((c) => c.role === 'brand') || pal[0] || {}).hex || '#E55B2A';
  const darkRaw = (pal.find((c) => c.role === 'dark') || {}).hex || '';
  const lightRaw = (pal.find((c) => c.role === 'light') || {}).hex || '';
  const olive = (pal.find((c) => c.role === 'neutral') || {}).hex || '#4A5233';

  // ---- FULL BRAND-DRIVEN THEME ----------------------------------------------
  // Every surface colour is derived from the brand so each website's document
  // looks on-brand, not always cream/charcoal. We keep contrast safe: text is
  // always dark-on-light / light-on-dark, and the background is a soft tint.
  //
  // Dark anchor: the site's dark colour if it's genuinely dark, else a deep,
  // slightly brand-tinted charcoal (brand hue mixed into near-black).
  let dark = darkRaw;
  if (!dark || lum(dark) > 0.25) dark = mix('#1b1b1e', brand, 0.08); // tint charcoal with brand
  // Light anchor / "sand" SWATCH colour — this is a BRAND colour pulled from the
  // site and is NEVER altered here. The site's light colour if it's light enough,
  // else a soft tint of the brand (Pack-Wheel-style off-white).
  let light = lightRaw;
  if (!light || lum(light) < 0.80) light = mix('#ffffff', brand, 0.05); // ~5% brand tint on white
  // PAGE BACKGROUND only: a SUBTLE tone-down of the light colour — a hint darker
  // and slightly warm-grey — so the deck surface sits a step below the light
  // swatch/panels and they're distinguishable. The swatch itself (--sand) is
  // untouched; we only nudge the surface behind it. Kept gentle so the swatch
  // reads as a soft step up, never as a bright white block.
  const pageBg = mix(light, '#9a958a', 0.10); // ~10% toward a warm grey = quiet background
  // Headings: a dark, brand-tinted ink that stays readable on the light bg.
  const heading = lum(brand) < 0.5 ? mix(dark, brand, 0.22) : dark;
  // Sub-headings / body-strong: slightly lighter than headings.
  const subhead = lighten(heading, 0.18);
  // Eyebrow / accents: the brand colour, but ensure it reads on the light bg;
  // if the brand is too pale, deepen it.
  const accent = lum(brand) > 0.72 ? darken(brand, 0.22) : brand;
  // Panels / cards on the light background: white, or a hair of brand tint.
  const panel = mix('#ffffff', brand, 0.02);
  // Muted text, tinted toward the brand hue so it feels cohesive.
  const muted = mix('#6b7280', brand, 0.10);
  const line = mix('#e5e1d8', brand, 0.06);

  // ---- Build ONE clean, de-duplicated pool of usable photos. Every image slot
  // in the deck is then filled by cycling this pool, so a blank or blown-out
  // slot never appears: if the site gave us 3 good photos, we reuse them rather
  // than leaving the 4th card white (the old "missing image" bug).
  const imgs = data.images || {};
  const uniq = (arr) => {
    const seen = new Set(); const out = [];
    for (const i of (arr || [])) {
      const url = i && i.url;
      if (!url || seen.has(url)) continue;
      seen.add(url); out.push(i);
    }
    return out;
  };
  // User-uploaded photos lead the pool so the user's own choices are used first.
  const uploadFirst = (arr) => [...arr].sort((a, b) => (b && b.uploaded ? 1 : 0) - (a && a.uploaded ? 1 : 0));
  const allLife = uploadFirst(uniq([...(imgs.lifestyle || []), ...(imgs.all || [])]));
  const allProd = uploadFirst(uniq(imgs.product || []));
  // Photos that are safe for the cover / grids (no baked-in promo text).
  const cleanLife = allLife.filter((i) => !looksLikeBanner(i));
  const banner = (imgs.all || []).concat(imgs.lifestyle || []).find(looksLikeBanner)
    || (data.cover && data.cover.heroImage ? { url: data.cover.heroImage } : null);

  // Cover hero: an explicit uploaded cover wins; else a CLEAN action photo
  // (never the promo banner); else the banner; else the og hero.
  const uploadedCover = (data.cover && data.cover.heroImage) || '';
  const coverHero = uploadedCover
    || (cleanLife[0] && cleanLife[0].url)
    || (banner && banner.url)
    || imgs.hero || '';

  // Ordered pool for the 4-up grids & galleries: clean photos first, then
  // anything else we have, so cards fill left-to-right with real photos.
  const gridPool = uniq([...cleanLife, ...allLife, ...allProd])
    .map((i) => i.url).filter(Boolean)
    .filter((u) => u !== coverHero || cleanLife.length <= 1); // keep cover distinct when possible
  const pool = gridPool.length ? gridPool : [coverHero].filter(Boolean);
  const at = (i) => pool.length ? pool[i % pool.length] : '';

  const flat = {};
  // life0..5 and prod0..3 always resolve to SOME real photo (cycled).
  for (let i = 0; i < 6; i++) flat['life' + i] = at(i);
  // product slots prefer real product shots, else continue cycling the pool.
  const prodPool = (allProd.map((i) => i.url).filter(Boolean));
  for (let i = 0; i < 4; i++) flat['prod' + i] = prodPool[i] || at(i + 2);
  flat.heroImg = coverHero;
  // Flat ordered list for {{#each}} grids via (lookup imgLife @index) — always
  // the same cycled pool, so every pillar/audience card gets a real photo.
  flat.imgLife = []; for (let i = 0; i < 6; i++) flat.imgLife.push(at(i));
  // One photo per product, "AI pick best per product": prefer real product
  // shots, then fall back to cycling the clean pool so every card has an image.
  const prodImgPool = prodPool.length ? prodPool : pool;
  flat.imgProd = []; for (let i = 0; i < 4; i++) flat.imgProd.push(prodImgPool.length ? prodImgPool[i % prodImgPool.length] : at(i));
  // "Stand for" slide shows the captioned marketing banner when we have one.
  flat.standImg = (banner && banner.url) || coverHero || at(1);
  // Thank-you page: a different clean photo than the cover; else reuse hero.
  flat.tyImg = pool.find((u) => u && u !== coverHero) || coverHero || '';
  // Pre-publish check image: a clean product/portrait-ish photo, distinct from cover.
  flat.checkImg = prodPool[0] || pool.find((u) => u && u !== coverHero) || coverHero || '';

  // How many usable photos we actually have — the template uses this to decide
  // whether to show image-heavy layouts or fall back to a text layout.
  const poolCount = pool.filter(Boolean).length;
  // Lifestyle gallery: feature photo + up to 4 more tiles, showing ALL the
  // distinct photos we have rather than a fixed 5-cell layout.
  const galAll = uniq(pool.map((u) => ({ url: u }))).map((x) => x.url);
  flat.galFeature = galAll[0] || '';
  flat.galTiles = galAll.slice(1, 5);   // up to 4 tiles beside the feature
  flat.galFew = galAll.length <= 3;      // layout hint for 2-3 photos

  // ---- SOCIAL fallbacks: the AI social call can fail / truncate, which left
  // pages 19-21 nearly empty. Guarantee substantive content for every social
  // slide, using AI output when it's there and sensible defaults when it isn't.
  const social = data.social || {};
  const platforms = (data.platforms && data.platforms.length ? data.platforms : ['Instagram', 'Facebook', 'YouTube']);
  const ppm = data.postsPerMonth || 10;
  const biz = (data.report && data.report.business) || 'the brand';

  const defSpecs = [
    { ratio: '4:5', name: 'Feed post', size: '1080 × 1350' },
    { ratio: '1:1', name: 'Grid / carousel', size: '1080 × 1080' },
    { ratio: '9:16', name: 'Story / Reel', size: '1080 × 1920' },
    { ratio: '16:9', name: 'YouTube / web', size: '1920 × 1080' },
  ];
  const aiSpecs = Array.isArray(social.creativeSpecs) ? social.creativeSpecs : [];
  const specs = defSpecs.map((d, i) => ({
    name: (aiSpecs[i] && aiSpecs[i].name) || d.name,
    size: (aiSpecs[i] && (aiSpecs[i].size || aiSpecs[i].ratio)) || d.size,
  }));

  let creativeRulesList = (Array.isArray(social.creativeRules) && social.creativeRules.length)
    ? social.creativeRules
    : [
        'Logo on every asset, in a corner, 8–10% of width.',
        'Brand colour for one thing only — the thing people should notice.',
        'Real photography over stock; show the product in genuine use.',
        'Headlines bold and tight; keep captions short and specific.',
        'Leave safe margins — nothing important near the edges.',
        'One clear message per post; never crowd the frame.',
      ];

  let pillarsList = Array.isArray(social.contentPillars) ? social.contentPillars.filter((p) => p && (p.title || p.desc)) : [];
  if (pillarsList.length < 3) {
    pillarsList = [
      { pct: '35%', title: 'Product in action', desc: 'Real use in real context — the product doing its job.', example: 'A short clip or photo of the product being used on location.' },
      { pct: '25%', title: 'Education & how-to', desc: 'Tips, guides and answers to the questions buyers actually ask.', example: 'A carousel breaking down one feature or decision.' },
      { pct: '20%', title: 'Social proof', desc: 'Customers, reviews and results that build trust.', example: 'A customer quote over a photo of their result.' },
      { pct: '20%', title: 'Brand & behind-the-scenes', desc: 'Who we are, what we stand for, the people behind it.', example: 'A founder note or a look behind the build.' },
    ];
  }

  const rhythmText = social.rhythm
    || `About ${ppm} posts a month across ${platforms.join(', ')} — a steady weekly cadence of ${Math.max(1, Math.round(ppm / 4))}–${Math.max(2, Math.round(ppm / 4) + 1)} posts, mixing the pillars so the feed never looks one-note.`;

  let checklistList = Array.isArray(social.checklist) ? social.checklist.filter(Boolean) : [];
  if (checklistList.length < 6) {
    checklistList = [
      'Logo present, correct version, with clear space.',
      'Brand colour used for emphasis only — not everywhere.',
      'Headline in the brand typeface, bold and tight.',
      `Brand name written correctly (“${biz}”), no typos.`,
      'Only approved claims — nothing unverified or exaggerated.',
      'Photo is on-brand: real, in-context, high resolution.',
      'Caption in the brand voice; words-we-avoid are gone.',
      'Correct size and safe margins for the platform.',
    ];
  }

  // ---- HARD OVERFLOW SAFETY -------------------------------------------------
  // The richer multi-page crawl made the AI write longer copy, which overran the
  // fixed-size slides. Cap item counts and truncate over-long strings so every
  // dense page fits inside its slide, above the footer, no matter what the AI
  // returns. (The AI prompts also ask for shorter copy; this is the backstop.)
  const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).replace(/[\s,;:.–—-]+$/, '') + '…' : s; };
  // Content pillars: at most 4 cards; short desc + example.
  pillarsList = pillarsList.slice(0, 4).map((p) => ({ ...p, title: clip(p.title, 46), desc: clip(p.desc, 150), example: p.example ? clip(p.example, 130) : '' }));
  // Pre-publish checklist: at most 8 one-liners.
  checklistList = checklistList.slice(0, 8).map((c) => clip(c, 150));
  // Creative rules: at most 6 short bullets.
  creativeRulesList = creativeRulesList.slice(0, 6).map((c) => clip(c, 130));
  // Seasonal calendar: at most 5 cards; short focus text.
  if (data.social && Array.isArray(data.social.calendar)) {
    data = { ...data, social: { ...data.social,
      calendar: data.social.calendar.slice(0, 5).map((c) => ({ period: clip(c.period, 28), label: clip(c.label, 34), focus: clip(c.focus, 240) })),
      calendarRule: data.social.calendarRule ? clip(data.social.calendarRule, 170) : data.social.calendarRule,
    } };
  }
  // Voice table: at most 5 rows; concise cells.
  if (data.voice && Array.isArray(data.voice.voiceTable)) {
    data = { ...data, voice: { ...data.voice,
      voiceTable: data.voice.voiceTable.slice(0, 5).map((r) => ({ trait: clip(r.trait, 26), are: clip(r.are, 150), areNot: clip(r.areNot, 150) })),
      voiceIntro: data.voice.voiceIntro ? clip(data.voice.voiceIntro, 200) : data.voice.voiceIntro,
    } };
  }
  // Names & claims: cap the side lists so the narrow column can't run off-page.
  if (data.voice && data.voice.namesClaims) {
    const nc = data.voice.namesClaims;
    data = { ...data, voice: { ...data.voice, namesClaims: { ...nc,
      write: Array.isArray(nc.write) ? nc.write.slice(0, 6).map((w) => ({ write: clip(w.write, 48), never: clip(w.never, 70) })) : nc.write,
      approvedClaims: Array.isArray(nc.approvedClaims) ? nc.approvedClaims.slice(0, 5).map((c) => clip(c, 70)) : nc.approvedClaims,
      checkFirst: Array.isArray(nc.checkFirst) ? nc.checkFirst.slice(0, 5).map((c) => clip(c, 70)) : nc.checkFirst,
    } } };
  }
  // Products: at most 3 cards, each at most 3 short bullets.
  if (data.foundation && Array.isArray(data.foundation.products)) {
    data = { ...data, foundation: { ...data.foundation,
      products: data.foundation.products.slice(0, 3).map((p) => ({ ...p,
        name: clip(p.name, 40), tag: clip(p.tag, 44),
        points: Array.isArray(p.points) ? p.points.slice(0, 3).map((b) => clip(b, 95)) : p.points,
      })),
    } };
  }
  // Audiences / pillars on the foundation pages: keep descriptions tight too.
  if (data.foundation && Array.isArray(data.foundation.audiences)) {
    data = { ...data, foundation: { ...data.foundation,
      audiences: data.foundation.audiences.slice(0, 4).map((a) => ({ ...a, name: clip(a.name, 48), desc: clip(a.desc, 150), line: a.line ? clip(a.line, 70) : a.line })),
    } };
  }
  if (data.foundation && Array.isArray(data.foundation.pillars)) {
    data = { ...data, foundation: { ...data.foundation,
      pillars: data.foundation.pillars.slice(0, 4).map((p) => ({ ...p, title: clip(p.title, 40), text: clip(p.text, 130) })),
    } };
  }

  return {
    ...data,
    palette: pal,
    img: flat,
    poolCount,
    specs, creativeRulesList, pillarsList, rhythmText, checklistList,
    brandCss: brand, brandDeep: shade(brand), darkCss: dark, lightCss: light, oliveCss: olive,
    pageBgCss: pageBg,
    // brand-driven theme tokens consumed by the template :root
    headingCss: heading, subheadCss: subhead, accentCss: accent,
    panelCss: panel, mutedCss: muted, lineCss: line,
    darkTextCss: textOn(dark), lightTextCss: textOn(light),
  };
}

async function renderBrandGuidelineHtml(data, opts = {}) {
  const tplSrc = await fs.readFile(path.join(__dirname, '../templates/brandGuideline.hbs'), 'utf8');
  const tpl = Handlebars.compile(tplSrc);
  return tpl({ ...bgViewModel(data), forWeb: !!opts.forWeb, assetDir: 'file://' + BG_ASSET_DIR });
}

async function renderBrandGuideline(data, slugBase) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const slug = `brandguide-${String(slugBase || (data.report && data.report.business) || 'guide').replace(/[^a-z0-9]/gi, '-')}`;
  const htmlPath = path.join(OUT_DIR, `${slug}.html`);
  const pdfPath = path.join(OUT_DIR, `${slug}.pdf`);
  await fs.writeFile(htmlPath, await renderBrandGuidelineHtml(data, { forWeb: true }), 'utf8');
  const pdfHtmlPath = path.join(OUT_DIR, `${slug}.pdf.html`);
  await fs.writeFile(pdfHtmlPath, await renderBrandGuidelineHtml(data, { forWeb: false }), 'utf8');
  await new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    execFile('python3', ['-m', 'weasyprint', '-e', 'utf-8', '-u', path.dirname(pdfHtmlPath), pdfHtmlPath, pdfPath], { timeout: 180000 },
      (err, stdout, stderr) => err ? reject(new Error(`WeasyPrint failed: ${stderr || err.message}`)) : resolve());
  });

  let pdfUrl = null, htmlUrl = null, pdfFileId = null, htmlFileId = null;
  try {
    const ik = require('./imagekit');
    const { Settings } = require('../models');
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (ik.isConfigured(settings)) {
      const webHtml = await renderBrandGuidelineHtml(data, { forWeb: true });
      const [pr, hr] = await Promise.all([
        fs.readFile(pdfPath).then((buf) => ik.uploadFile({ base64: buf.toString('base64'), fileName: `${slug}.pdf`, folder: '/qtonix/brandguide/reports' })),
        ik.uploadFile({ base64: Buffer.from(webHtml, 'utf8').toString('base64'), fileName: `${slug}.html`, folder: '/qtonix/brandguide/reports' }),
      ]);
      pdfUrl = pr.url; pdfFileId = pr.fileId || null;
      htmlUrl = hr.url; htmlFileId = hr.fileId || null;
    }
  } catch (e) { console.error('[renderBrandGuideline] ImageKit upload failed, keeping local only:', e.message); }

  return { pdfPath, htmlPath, pdfUrl, htmlUrl, pdfFileId, htmlFileId };
}

module.exports = { renderReport, renderHtml, buildViewModel, renderPreSeo, renderPreSeoHtml, renderBrandGuideline, renderBrandGuidelineHtml };
