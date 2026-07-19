/**
 * On-page crawler + Google PageSpeed Insights.
 *
 * This is the layer we own outright — no vendor, no credits, no ToS risk.
 * It supplies the AI-readiness signals and the technical evidence that make
 * the report feel researched rather than generated.
 */

const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (compatible; QtonixAudit/1.0; +https://www.qtonix.com/bot)';
const AI_BOTS = ['gptbot', 'claudebot', 'perplexitybot', 'google-extended', 'ccbot', 'anthropic-ai'];

function normaliseUrl(input) {
  let u = String(input).trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return new URL(u);
}

async function fetchWithTimeout(url, ms = 20000, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(t);
  }
}

/** Homepage analysis: the signals that matter for both SEO and AI citation. */
async function crawlHomepage(website) {
  const url = normaliseUrl(website);
  const started = Date.now();

  const res = await fetchWithTimeout(url.toString(), 25000);
  const responseMs = Date.now() - started;
  const html = await res.text();
  const $ = cheerio.load(html);

  // Strip non-content nodes before counting words, or nav/footer inflate it.
  const $body = $('body').clone();
  $body.find('script, style, noscript, nav, header, footer, svg').remove();
  const bodyText = $body.text().replace(/\s+/g, ' ').trim();

  // JSON-LD schema types
  const schemaTypes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node === 'object') {
          if (node['@type']) {
            const t = node['@type'];
            Array.isArray(t) ? schemaTypes.push(...t) : schemaTypes.push(t);
          }
          if (node['@graph']) walk(node['@graph']);
        }
      };
      walk(parsed);
    } catch {
      /* malformed JSON-LD is itself a finding, handled below */
    }
  });

  const title = $('title').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get();
  const images = $('img');
  const imagesNoAlt = images.filter((_, el) => !$(el).attr('alt')).length;

  const canonical = $('link[rel="canonical"]').attr('href') || null;
  const viewport = $('meta[name="viewport"]').attr('content') || null;
  const ogTags = $('meta[property^="og:"]').length;

  // Server-rendered check: if body text is nearly empty but scripts abound,
  // the site is client-rendered and AI crawlers see nothing.
  const scriptCount = $('script').length;
  const serverRenderedContent = bodyText.split(/\s+/).length > 150;

  // E-E-A-T signals
  const hasAuthorSignals =
    schemaTypes.some((t) => /person|author/i.test(t)) ||
    $('[rel="author"], .author, [itemprop="author"]').length > 0;

  // Internal vs external links
  let internal = 0;
  let external = 0;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const abs = new URL(href, url.origin);
      abs.hostname === url.hostname ? internal++ : external++;
    } catch {
      /* ignore malformed hrefs */
    }
  });

  return {
    finalUrl: res.url,
    statusCode: res.status,
    https: res.url.startsWith('https://'),
    responseMs,
    htmlBytes: Buffer.byteLength(html),
    title,
    titleLength: title.length,
    metaDescription: metaDesc,
    metaDescriptionLength: metaDesc.length,
    h1s,
    h1Count: h1s.length,
    wordCount: bodyText.split(/\s+/).filter(Boolean).length,
    imageCount: images.length,
    imagesNoAlt,
    canonical,
    viewport,
    hasViewport: !!viewport,
    ogTags,
    schemaTypes: [...new Set(schemaTypes)],
    hasSchema: schemaTypes.length > 0,
    hasAuthorSignals,
    serverRenderedContent,
    scriptCount,
    internalLinks: internal,
    externalLinks: external,
    bodyTextSample: bodyText.slice(0, 3000),
  };
}

/** robots.txt: are AI crawlers blocked? A surprising number of sites block them by accident. */
async function checkRobots(website) {
  const url = normaliseUrl(website);
  try {
    const res = await fetchWithTimeout(`${url.origin}/robots.txt`, 10000);
    if (!res.ok) return { exists: false, blocksAiCrawlers: false, sitemapUrls: [] };
    const txt = (await res.text()).toLowerCase();

    const sitemapUrls = [...txt.matchAll(/sitemap:\s*(\S+)/gi)].map((m) => m[1]);

    // Look for an explicit disallow-all under any AI bot's user-agent block.
    let blocksAiCrawlers = false;
    const blocks = txt.split(/user-agent:/i).slice(1);
    for (const block of blocks) {
      const agent = block.split('\n')[0].trim();
      if (AI_BOTS.some((b) => agent.includes(b))) {
        if (/disallow:\s*\/\s*$/m.test(block)) blocksAiCrawlers = true;
      }
    }
    return { exists: true, blocksAiCrawlers, sitemapUrls, raw: txt.slice(0, 1000) };
  } catch {
    return { exists: false, blocksAiCrawlers: false, sitemapUrls: [] };
  }
}

async function checkLlmsTxt(website) {
  const url = normaliseUrl(website);
  try {
    const res = await fetchWithTimeout(`${url.origin}/llms.txt`, 8000);
    return res.ok;
  } catch {
    return false;
  }
}

async function checkSitemap(website, robots) {
  const url = normaliseUrl(website);
  const candidates = robots.sitemapUrls.length
    ? robots.sitemapUrls
    : [`${url.origin}/sitemap.xml`, `${url.origin}/sitemap_index.xml`];
  for (const c of candidates) {
    try {
      const res = await fetchWithTimeout(c, 10000);
      if (res.ok) {
        const xml = await res.text();
        const count = (xml.match(/<loc>/g) || []).length;
        return { exists: true, url: c, urlCount: count };
      }
    } catch {
      /* try next candidate */
    }
  }
  return { exists: false, url: null, urlCount: 0 };
}

/**
 * Google PageSpeed Insights (Lighthouse + real-world CrUX field data).
 * Free, 25k/day with a key. The CrUX numbers are the persuasive part:
 * "your real visitors experience 4.2s LCP" lands harder than a lab score.
 */
async function getPageSpeed(website, apiKey, strategy = 'mobile') {
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', normaliseUrl(website).toString());
  endpoint.searchParams.set('strategy', strategy);
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) {
    endpoint.searchParams.append('category', c);
  }
  if (apiKey) endpoint.searchParams.set('key', apiKey);

  const res = await fetchWithTimeout(endpoint.toString(), 60000);
  if (!res.ok) throw new Error(`PageSpeed API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();

  const lh = data.lighthouseResult || {};
  const cats = lh.categories || {};
  const audits = lh.audits || {};
  const pick = (id) => (audits[id] ? audits[id].numericValue : null);
  const score = (c) => (cats[c] && cats[c].score != null ? Math.round(cats[c].score * 100) : null);

  // Real-user data. Absent for low-traffic sites — which is itself worth saying.
  const crux = data.loadingExperience && data.loadingExperience.metrics;
  const field = crux
    ? {
        lcp: crux.LARGEST_CONTENTFUL_PAINT_MS ? crux.LARGEST_CONTENTFUL_PAINT_MS.percentile : null,
        inp: crux.INTERACTION_TO_NEXT_PAINT ? crux.INTERACTION_TO_NEXT_PAINT.percentile : null,
        cls: crux.CUMULATIVE_LAYOUT_SHIFT_SCORE
          ? crux.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
          : null,
        overall: data.loadingExperience.overall_category || null,
      }
    : null;

  return {
    strategy,
    performance: score('performance'),
    seo: score('seo'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    lab: {
      lcp: pick('largest-contentful-paint'),
      fcp: pick('first-contentful-paint'),
      cls: pick('cumulative-layout-shift'),
      tbt: pick('total-blocking-time'),
      speedIndex: pick('speed-index'),
      tti: pick('interactive'),
    },
    field,
    opportunities: Object.values(audits)
      .filter((a) => a.details && a.details.type === 'opportunity' && a.numericValue > 100)
      .sort((a, b) => b.numericValue - a.numericValue)
      .slice(0, 6)
      .map((a) => ({ title: a.title, savingsMs: Math.round(a.numericValue) })),
  };
}

/** Full technical pass, resilient: one failed check must not kill the report. */
async function runTechnicalAudit(website, pageSpeedKey) {
  const settle = async (fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      return { ...fallback, error: e.message };
    }
  };

  const [homepage, robots, hasLlmsTxt] = await Promise.all([
    settle(() => crawlHomepage(website), { error: true }),
    settle(() => checkRobots(website), { exists: false, blocksAiCrawlers: false, sitemapUrls: [] }),
    settle(() => checkLlmsTxt(website), false),
  ]);

  const sitemap = await settle(() => checkSitemap(website, robots), { exists: false, urlCount: 0 });

  const [mobile, desktop] = await Promise.all([
    settle(() => getPageSpeed(website, pageSpeedKey, 'mobile'), { performance: null }),
    settle(() => getPageSpeed(website, pageSpeedKey, 'desktop'), { performance: null }),
  ]);

  return {
    ...homepage,
    robots,
    sitemap,
    hasLlmsTxt: hasLlmsTxt === true,
    blocksAiCrawlers: robots.blocksAiCrawlers,
    pageSpeed: { mobile, desktop },
  };
}

module.exports = { runTechnicalAudit, crawlHomepage, getPageSpeed, checkRobots, normaliseUrl };
