/**
 * Scoring engine.
 *
 * Every score is derived from a real measurement. Nothing here is decorative:
 * each deduction maps to a named issue and therefore to a billable fix.
 *
 * Six dials, matching the report sections:
 *   technical / onPage / content / authority / local / aiVisibility
 */

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Industry-standard organic CTR by position. Used for traffic-value maths. */
const CTR_BY_POSITION = {
  1: 0.279, 2: 0.157, 3: 0.11, 4: 0.08, 5: 0.061,
  6: 0.047, 7: 0.038, 8: 0.031, 9: 0.026, 10: 0.023,
};
const ctrFor = (pos) => {
  if (pos <= 10) return CTR_BY_POSITION[pos] || 0.02;
  if (pos <= 20) return 0.012;
  if (pos <= 30) return 0.006;
  return 0.002;
};

/**
 * The money number. Traffic value = volume x CTR-delta x CPC.
 * Loss framing: what they're leaving on the table by not being on page 1.
 */
function calculateOpportunityValue(keywords, currency = 'USD') {
  let currentValue = 0;
  let potentialValue = 0;
  const opportunities = [];

  for (const kw of keywords || []) {
    const volume = Number(kw.volume) || 0;
    const cpc = Number(kw.cpc) || 0;
    const pos = Number(kw.position) || 100;
    if (!volume || !cpc) continue;

    const nowClicks = volume * ctrFor(pos);
    const targetClicks = volume * ctrFor(Math.min(pos, 3)); // realistic target: top 3
    currentValue += nowClicks * cpc;
    potentialValue += targetClicks * cpc;

    const gap = (targetClicks - nowClicks) * cpc;
    if (gap > 0) {
      opportunities.push({
        keyword: kw.keyword,
        position: pos,
        volume,
        cpc,
        monthlyGap: Math.round(gap),
        difficulty: kw.difficulty,
      });
    }
  }

  opportunities.sort((a, b) => b.monthlyGap - a.monthlyGap);

  return {
    currency,
    currentMonthlyValue: Math.round(currentValue),
    potentialMonthlyValue: Math.round(potentialValue),
    monthlyGap: Math.round(potentialValue - currentValue),
    annualGap: Math.round((potentialValue - currentValue) * 12),
    topOpportunities: opportunities.slice(0, 15),
  };
}

function scoreTechnical(crawl) {
  const issues = [];
  let score = 100;
  const ps = (crawl.pageSpeed && crawl.pageSpeed.mobile) || {};

  if (ps.performance != null) {
    if (ps.performance < 50) {
      score -= 25;
      issues.push({
        severity: 'critical',
        title: `Mobile speed score is ${ps.performance}/100`,
        detail: 'Over half of visitors leave a page that takes more than 3 seconds on mobile.',
      });
    } else if (ps.performance < 90) {
      score -= 10;
      issues.push({
        severity: 'warning',
        title: `Mobile speed score is ${ps.performance}/100`,
        detail: 'There is measurable headroom here.',
      });
    }
  }

  // CrUX field data is the strongest evidence available — real visitors, not a lab.
  if (ps.field && ps.field.lcp) {
    const lcpSec = (ps.field.lcp / 1000).toFixed(1);
    if (ps.field.lcp > 2500) {
      score -= 15;
      issues.push({
        severity: ps.field.lcp > 4000 ? 'critical' : 'warning',
        title: `Real visitors wait ${lcpSec}s for your main content`,
        detail: `Google's threshold is 2.5s. This is measured from your actual traffic, not a simulation.`,
      });
    }
  }

  if (!crawl.https) {
    score -= 20;
    issues.push({
      severity: 'critical',
      title: 'Site is not served over HTTPS',
      detail: 'Browsers mark the site "Not secure". This suppresses both rankings and conversions.',
    });
  }
  if (!crawl.hasViewport) {
    score -= 15;
    issues.push({
      severity: 'critical',
      title: 'No mobile viewport tag',
      detail: 'The site cannot render correctly on phones, where most searches happen.',
    });
  }
  if (!crawl.sitemap || !crawl.sitemap.exists) {
    score -= 8;
    issues.push({
      severity: 'warning',
      title: 'No XML sitemap found',
      detail: 'Search engines are left to discover your pages by chance.',
    });
  }
  if (!crawl.robots || !crawl.robots.exists) {
    score -= 4;
    issues.push({
      severity: 'notice',
      title: 'No robots.txt file',
      detail: 'You have no control over how crawlers spend their budget on your site.',
    });
  }
  if (crawl.blocksAiCrawlers) {
    score -= 12;
    issues.push({
      severity: 'critical',
      title: 'robots.txt blocks AI crawlers',
      detail: 'GPTBot / ClaudeBot / PerplexityBot are disallowed. You are invisible to AI search by configuration.',
    });
  }
  if (!crawl.serverRenderedContent) {
    score -= 12;
    issues.push({
      severity: 'critical',
      title: 'Content requires JavaScript to appear',
      detail: 'Most AI crawlers and some search crawlers will see an effectively blank page.',
    });
  }

  return { score: clamp(score), issues };
}

function scoreOnPage(crawl) {
  const issues = [];
  let score = 100;

  if (!crawl.title) {
    score -= 20;
    issues.push({ severity: 'critical', title: 'Homepage has no title tag', detail: 'This is the single strongest on-page ranking signal.' });
  } else if (crawl.titleLength > 60) {
    score -= 5;
    issues.push({ severity: 'notice', title: `Title is ${crawl.titleLength} characters`, detail: 'Google truncates past ~60. Your message is being cut off.' });
  } else if (crawl.titleLength < 30) {
    score -= 5;
    issues.push({ severity: 'notice', title: `Title is only ${crawl.titleLength} characters`, detail: 'Unused space that could target a real search.' });
  }

  if (!crawl.metaDescription) {
    score -= 12;
    issues.push({ severity: 'warning', title: 'No meta description', detail: 'Google writes your search snippet for you — badly.' });
  } else if (crawl.metaDescriptionLength > 160) {
    score -= 3;
    issues.push({ severity: 'notice', title: `Meta description is ${crawl.metaDescriptionLength} characters`, detail: 'Truncated in results past ~160.' });
  }

  if (crawl.h1Count === 0) {
    score -= 15;
    issues.push({ severity: 'critical', title: 'No H1 heading', detail: 'The page never states what it is about.' });
  } else if (crawl.h1Count > 1) {
    score -= 5;
    issues.push({ severity: 'notice', title: `${crawl.h1Count} H1 tags found`, detail: 'Competing headings dilute the topic signal.' });
  }

  if (crawl.imagesNoAlt > 0) {
    const pct = Math.round((crawl.imagesNoAlt / Math.max(crawl.imageCount, 1)) * 100);
    score -= Math.min(12, crawl.imagesNoAlt);
    issues.push({
      severity: pct > 50 ? 'warning' : 'notice',
      title: `${crawl.imagesNoAlt} of ${crawl.imageCount} images have no alt text`,
      detail: 'Invisible to image search, screen readers, and AI crawlers.',
    });
  }

  if (!crawl.canonical) {
    score -= 5;
    issues.push({ severity: 'notice', title: 'No canonical tag', detail: 'Duplicate-content risk across URL variants.' });
  }
  if (!crawl.hasSchema) {
    score -= 12;
    issues.push({ severity: 'warning', title: 'No structured data (schema)', detail: 'You forfeit rich results, and AI systems cannot identify your entity.' });
  }
  if (crawl.ogTags < 3) {
    score -= 4;
    issues.push({ severity: 'notice', title: 'Incomplete Open Graph tags', detail: 'Shared links render badly on social, cutting click-through.' });
  }

  return { score: clamp(score), issues };
}

function scoreContent(crawl, keywordData) {
  const issues = [];
  let score = 100;

  if (crawl.wordCount < 300) {
    score -= 25;
    issues.push({ severity: 'critical', title: `Homepage has only ${crawl.wordCount} words`, detail: 'Too thin to rank for anything competitive.' });
  } else if (crawl.wordCount < 600) {
    score -= 12;
    issues.push({ severity: 'warning', title: `Homepage has ${crawl.wordCount} words`, detail: 'Below the depth of pages that rank in this space.' });
  }

  const total = (keywordData && keywordData.totalKeywords) || 0;
  const page1 = (keywordData && keywordData.page1Keywords) || 0;

  if (total === 0) {
    score -= 30;
    issues.push({ severity: 'critical', title: 'Ranking for no tracked keywords', detail: 'The site is effectively absent from search.' });
  } else if (page1 === 0) {
    score -= 20;
    issues.push({ severity: 'critical', title: `Ranking for ${total} keywords, none on page 1`, detail: 'Ranking on page 2+ earns almost no clicks.' });
  }

  if (crawl.internalLinks < 10) {
    score -= 8;
    issues.push({ severity: 'warning', title: `Only ${crawl.internalLinks} internal links`, detail: 'Authority is not flowing between your pages.' });
  }

  return { score: clamp(score), issues };
}

function scoreAuthority(backlinks, competitors) {
  const issues = [];
  let score = 100;

  const da = (backlinks && backlinks.domainAuthority) || 0;
  const refs = (backlinks && backlinks.referringDomains) || 0;
  const avgCompDa =
    competitors && competitors.length
      ? Math.round(competitors.reduce((s, c) => s + (c.domainAuthority || 0), 0) / competitors.length)
      : 0;

  if (da < 10) {
    score -= 35;
    issues.push({ severity: 'critical', title: `Domain Authority is ${da}`, detail: 'Effectively no trust signal. Competitive terms are out of reach until this moves.' });
  } else if (da < 30) {
    score -= 18;
    issues.push({ severity: 'warning', title: `Domain Authority is ${da}`, detail: 'Enough to rank long-tail, not enough for money terms.' });
  }

  if (avgCompDa > 0 && da < avgCompDa - 15) {
    score -= 12;
    issues.push({
      severity: 'critical',
      title: `Authority gap: you are ${da}, competitors average ${avgCompDa}`,
      detail: 'This gap, not content quality, is why they outrank you.',
    });
  }

  if (refs < 20) {
    score -= 15;
    issues.push({ severity: 'warning', title: `Only ${refs} referring domains`, detail: 'Too narrow a link base to compete.' });
  }

  const toxicPct = (backlinks && backlinks.toxicPercentage) || 0;
  if (toxicPct > 30) {
    score -= 20;
    issues.push({
      severity: 'critical',
      title: `${toxicPct}% of referring domains look low-quality or spam`,
      detail: 'These add no authority and carry risk. They need auditing and disavowing.',
    });
  }

  return { score: clamp(score), issues, competitorAverage: avgCompDa };
}

function scoreLocal(local) {
  if (!local || !local.enabled) return { score: null, issues: [], skipped: true };
  const issues = [];
  let score = 100;

  if (!local.gbpFound) {
    score -= 40;
    issues.push({ severity: 'critical', title: 'No Google Business Profile found', detail: 'You are absent from the map pack, where local buying decisions happen.' });
  } else {
    if ((local.reviewCount || 0) < 10) {
      score -= 20;
      issues.push({ severity: 'warning', title: `Only ${local.reviewCount || 0} reviews`, detail: 'Review count and velocity are among the strongest map-pack factors.' });
    }
    if ((local.rating || 0) < 4.0 && local.rating) {
      score -= 15;
      issues.push({ severity: 'warning', title: `Rating is ${local.rating}`, detail: 'Below 4.0 measurably suppresses calls and clicks.' });
    }
    if (!local.hasHours) {
      score -= 8;
      issues.push({ severity: 'notice', title: 'Opening hours missing', detail: 'Incomplete profiles rank lower.' });
    }
  }
  return { score: clamp(score), issues };
}

function scoreAiVisibility(ai) {
  if (!ai) return { score: null, issues: [], skipped: true };
  const issues = [];

  // Weighted: assistant recall 50%, technical readiness 30%, AI Overview citation 20%.
  const sov = ai.shareOfVoice || 0;
  const readiness = ai.readinessScore || 0;
  let overviewScore = 0;
  if (ai.aiOverview) {
    const cited = ai.aiOverview.citedCount || 0;
    const total = (ai.aiOverview.citedCount || 0) + (ai.aiOverview.gapCount || 0);
    overviewScore = total ? Math.round((cited / total) * 100) : 0;
  }

  const score = clamp(sov * 0.5 + readiness * 0.3 + overviewScore * 0.2);

  if (sov === 0) {
    issues.push({
      severity: 'critical',
      title: 'Never named by AI assistants in buyer questions',
      detail: `Across ${ai.promptsTested} genuine buying questions, the brand was not recommended once.`,
    });
  } else if (sov < 40) {
    issues.push({
      severity: 'warning',
      title: `Named in only ${sov}% of buyer questions`,
      detail: 'Competitors are being recommended in the conversations you are missing.',
    });
  }

  for (const c of ai.readiness || []) {
    if (!c.pass) issues.push({ severity: 'warning', title: c.label + ' — missing', detail: c.detail });
  }

  if (ai.aiOverview && ai.aiOverview.gapCount > 0) {
    issues.push({
      severity: 'warning',
      title: `${ai.aiOverview.gapCount} keywords show an AI Overview that does not cite you`,
      detail: 'Google is answering these questions with someone else\'s content.',
    });
  }

  return { score, issues };
}

/** Overall = weighted mean of the dials that actually ran. */
function calculateOverall(scores) {
  const weights = {
    technical: 0.2,
    onPage: 0.15,
    content: 0.2,
    authority: 0.25,
    aiVisibility: 0.15,
    local: 0.05,
  };
  let sum = 0;
  let weightUsed = 0;
  for (const [k, w] of Object.entries(weights)) {
    const s = scores[k] && scores[k].score;
    if (s == null) continue;
    sum += s * w;
    weightUsed += w;
  }
  return weightUsed ? clamp(sum / weightUsed) : 0;
}

const grade = (s) =>
  s >= 80 ? { letter: 'A', label: 'Strong', tone: 'good' }
  : s >= 65 ? { letter: 'B', label: 'Fair', tone: 'ok' }
  : s >= 50 ? { letter: 'C', label: 'Weak', tone: 'warn' }
  : s >= 35 ? { letter: 'D', label: 'Poor', tone: 'bad' }
  : { letter: 'F', label: 'Critical', tone: 'bad' };

/**
 * Roadmap: impact / effort, sliced into 30-60-90.
 * Sorted so the sales conversation writes itself.
 */
function buildRoadmap(allIssues, services) {
  const effortOf = (t) =>
    /schema|alt text|meta|title|h1|robots|llms|sitemap|viewport/i.test(t) ? 1
    : /speed|content|internal link|canonical/i.test(t) ? 2
    : 3; // authority, backlinks, AI presence

  const impactOf = (sev) => (sev === 'critical' ? 3 : sev === 'warning' ? 2 : 1);

  const ranked = allIssues
    .map((i) => {
      const effort = effortOf(i.title);
      const impact = impactOf(i.severity);
      return { ...i, effort, impact, priority: impact / effort };
    })
    .sort((a, b) => b.priority - a.priority);

  return {
    phase1: ranked.filter((i) => i.effort === 1).slice(0, 8),
    phase2: ranked.filter((i) => i.effort === 2).slice(0, 8),
    phase3: ranked.filter((i) => i.effort === 3).slice(0, 8),
    quickWins: ranked.filter((i) => i.effort === 1 && i.impact >= 2).slice(0, 3),
    all: ranked,
  };
}

module.exports = {
  calculateOpportunityValue,
  scoreTechnical,
  scoreOnPage,
  scoreContent,
  scoreAuthority,
  scoreLocal,
  scoreAiVisibility,
  calculateOverall,
  grade,
  buildRoadmap,
  ctrFor,
};
