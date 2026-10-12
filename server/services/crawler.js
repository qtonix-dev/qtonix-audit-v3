/**
 * On-page crawler + Google PageSpeed Insights.
 *
 * This is the layer we own outright — no vendor, no credits, no ToS risk.
 * It supplies the AI-readiness signals and the technical evidence that make
 * the report feel researched rather than generated.
 */

const cheerio = require('cheerio');

// A real Chrome User-Agent + the headers a browser actually sends. The old
// "QtonixAudit" bot UA was being blocked by Cloudflare's bot protection, which
// returned a challenge page instead of the site's HTML and made briefs/reports
// fail. A browser-like fingerprint gets through the vast majority of the time.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-Ch-Ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};
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
      headers: { ...BROWSER_HEADERS, ...(opts.headers || {}) },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(t);
  }
}

// Does this response/body look like a Cloudflare (or similar) bot challenge
// rather than the real page? 403/503 with a challenge marker, or a tiny body
// that's just the "checking your browser" interstitial.
function looksLikeChallenge(status, html) {
  if (status === 403 || status === 503 || status === 429) return true;
  const h = String(html || '').toLowerCase();
  if (h.length < 3000 && (
    h.includes('cf-browser-verification') ||
    h.includes('checking your browser') ||
    h.includes('cf-challenge') ||
    h.includes('just a moment') ||
    h.includes('attention required') ||
    h.includes('enable javascript and cookies to continue')
  )) return true;
  return false;
}

// Last-resort reader fallback for pages behind a bot wall. r.jina.ai renders
// the page server-side and returns clean readable text/markdown. We wrap it in
// a minimal HTML shell so the rest of the crawler (cheerio) can parse it.
// Best-effort: any failure returns null and the caller keeps the original.
// NOTE: this makes an outbound call to r.jina.ai; it works in production.
async function fetchViaReader(targetUrl, ms = 25000) {
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${targetUrl}`, ms, {
      headers: { 'X-Return-Format': 'html', 'Accept': 'text/html,text/plain,*/*' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 200) return null;
    // If it already looks like HTML, use as-is; otherwise wrap the text so
    // cheerio has a <body> to read.
    const isHtml = /<html|<body|<div|<p[\s>]/i.test(text);
    const html = isHtml ? text : `<!doctype html><html><head></head><body><main>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</main></body></html>`;
    return html;
  } catch {
    return null;
  }
}

/** Homepage analysis: the signals that matter for both SEO and AI citation. */
async function crawlHomepage(website) {
  const url = normaliseUrl(website);
  const started = Date.now();

  const res = await fetchWithTimeout(url.toString(), 25000);
  const responseMs = Date.now() - started;
  let html = await res.text();
  // Cloudflare / bot-wall fallback: if the direct fetch came back as a
  // challenge page, re-read the page through the reader proxy so the brief
  // still has real content to work with.
  let readerUsed = false;
  if (looksLikeChallenge(res.status, html)) {
    const viaReader = await fetchViaReader(url.toString());
    if (viaReader) { html = viaReader; readerUsed = true; }
  }
  const $ = cheerio.load(html);

  // Strip non-content nodes before counting words, or nav/footer inflate it.
  const $body = $('body').clone();
  $body.find('script, style, noscript, nav, header, footer, svg').remove();
  const bodyText = $body.text().replace(/\s+/g, ' ').trim();

  // JSON-LD schema types + collect every object node (used for NAP extraction).
  const schemaTypes = [];
  const schemaNodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node === 'object') {
          schemaNodes.push(node);
          if (node['@type']) {
            const t = node['@type'];
            Array.isArray(t) ? schemaTypes.push(...t) : schemaTypes.push(t);
          }
          if (node['@graph']) walk(node['@graph']);
          // also walk nested objects (address, contactPoint, etc.)
          for (const k of Object.keys(node)) { const v = node[k]; if (v && typeof v === 'object') walk(v); }
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

  // Internal vs external links, plus social-media profile detection (for SMO).
  let internal = 0;
  let external = 0;
  const socialPatterns = {
    facebook: /facebook\.com|fb\.com/i,
    instagram: /instagram\.com/i,
    twitter: /twitter\.com|x\.com/i,
    linkedin: /linkedin\.com/i,
    youtube: /youtube\.com|youtu\.be/i,
    tiktok: /tiktok\.com/i,
    pinterest: /pinterest\./i,
  };
  const socialLinks = {};
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    // Social detection: match the href against known networks (first link wins).
    for (const [net, re] of Object.entries(socialPatterns)) {
      if (re.test(href) && !socialLinks[net]) {
        try { socialLinks[net] = new URL(href, url.origin).href; } catch { socialLinks[net] = href; }
      }
    }
    try {
      const abs = new URL(href, url.origin);
      abs.hostname === url.hostname ? internal++ : external++;
    } catch {
      /* ignore malformed hrefs */
    }
  });
  const socialNetworks = Object.keys(socialLinks);

  // ---- Signals for "what does this business actually offer?" ---------------
  // We collect nav/menu link labels, service-ish internal link labels, and
  // secondary headings. These get passed to the AI to infer the real service
  // list (rather than the services our agent selected when running the report).
  const serviceSignals = [];
  const pushSignal = (t) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    if (s && s.length >= 3 && s.length <= 60 && !serviceSignals.includes(s)) serviceSignals.push(s);
  };
  $('nav a, header a, .menu a, #menu a, ul.nav a').each((_, el) => pushSignal($(el).text()));
  $('a[href*="service"], a[href*="solution"], a[href*="product"], a[href*="what-we-do"]').each((_, el) => pushSignal($(el).text()));
  $('h2, h3').each((_, el) => pushSignal($(el).text()));
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 30);

  // ---- Analytics / tracking code detection (from raw HTML + scripts) --------
  const tracking = {
    ga4: /gtag\/js\?id=G-|gtag\(['"]config['"],\s*['"]G-|googletagmanager\.com\/gtag\/js\?id=G-/i.test(html),
    ua: /UA-\d{4,}-\d|google-analytics\.com\/analytics\.js|ga\(['"]create['"]/i.test(html),
    gtm: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/i.test(html),
    gsc: /google-site-verification/i.test(html),
    bing: /msvalidate\.01/i.test(html),
    metaPixel: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(['"]init['"]/i.test(html),
    hotjar: /static\.hotjar\.com|hjid/i.test(html),
    clarity: /clarity\.ms\/tag/i.test(html),
    linkedinInsight: /snap\.licdn\.com\/li\.lms-analytics/i.test(html),
    tiktokPixel: /analytics\.tiktok\.com/i.test(html),
  };

  // ---- NAP (name, address, phone) extraction -------------------------------
  // Priority: (1) structured data (JSON-LD PostalAddress / telephone / email),
  // (2) tel:/mailto: links in the page, (3) clean footer-only patterns. Returns
  // ARRAYS so a site with multiple offices/numbers shows them all.
  const footerText = $('footer').text().replace(/\s+/g, ' ').trim();
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map((s) => String(s).replace(/\s{2,}/g, ' ').trim()))];
  const normPhone = (p) => { const d = String(p).replace(/[^\d+]/g, ''); return d.length >= 7 && d.length <= 16 ? String(p).replace(/\s{2,}/g, ' ').trim() : null; };

  // Format a schema PostalAddress object into a single readable line.
  const fmtAddr = (a) => {
    if (!a) return null;
    if (typeof a === 'string') return a.replace(/\s{2,}/g, ' ').trim();
    if (typeof a !== 'object') return null;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry && (typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry)];
    const line = parts.filter(Boolean).join(', ').replace(/\s{2,}/g, ' ').trim();
    return line || null;
  };

  const napName = [];
  const napPhones = [];
  const napEmails = [];
  const napAddresses = [];
  // Source-tagged copies so we can compare what the SCHEMA says against what the
  // visible PAGE (footer / contact block / tel: links) says, and flag mismatches.
  const schemaNap = { names: [], phones: [], emails: [], addresses: [] };
  const pageNap = { names: [], phones: [], emails: [], addresses: [] };

  // (1) Structured data
  for (const node of schemaNodes) {
    const types = [].concat(node['@type'] || []);
    const isOrg = types.some((t) => /organization|localbusiness|store|restaurant|corporation/i.test(String(t)));
    if (isOrg && node.name && typeof node.name === 'string') { napName.push(node.name.trim()); schemaNap.names.push(node.name.trim()); }
    for (const key of ['telephone', 'phone']) if (node[key]) [].concat(node[key]).forEach((p) => { const v = normPhone(p); if (v) { napPhones.push(v); schemaNap.phones.push(v); } });
    if (node.email) [].concat(node.email).forEach((e) => { const v = String(e).replace(/^mailto:/i, '').trim(); napEmails.push(v); schemaNap.emails.push(v); });
    if (node.address) [].concat(node.address).forEach((a) => { const v = fmtAddr(a); if (v) { napAddresses.push(v); schemaNap.addresses.push(v); } });
    if (node.contactPoint) [].concat(node.contactPoint).forEach((cp) => { if (cp && cp.telephone) { const v = normPhone(cp.telephone); if (v) { napPhones.push(v); schemaNap.phones.push(v); } } if (cp && cp.email) { const v = String(cp.email).replace(/^mailto:/i, '').trim(); napEmails.push(v); schemaNap.emails.push(v); } });
  }

  // (2) tel: / mailto: links (reliable, author-intended contact points)
  $('a[href^="tel:"]').each((_, el) => { const v = normPhone(decodeURIComponent(($(el).attr('href') || '').replace(/^tel:/i, ''))); if (v) { napPhones.push(v); pageNap.phones.push(v); } });
  $('a[href^="mailto:"]').each((_, el) => { const e = ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0].trim(); if (e) { napEmails.push(e); pageNap.emails.push(e); } });

  // (3) Footer-only fallbacks (footer is where NAP usually lives; avoids pulling
  // review text / marketing copy from the body).
  if (!napPhones.length) { const m = footerText.match(/(\+?\d[\d\s().-]{7,}\d)/g) || []; m.forEach((p) => { const v = normPhone(p); if (v) { napPhones.push(v); pageNap.phones.push(v); } }); }
  if (!napEmails.length) { const m = (footerText + ' ' + html).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []; m.forEach((e) => { if (!/example\.|sentry|wixpress|\.png|\.jpg/i.test(e)) { napEmails.push(e); pageNap.emails.push(e); } }); }
  // Address extraction. A real address = street-number + street word, and a
  // postal code or country/city tail; marketing/review sentences are rejected.
  const JUNK = /(out of 5|award[- ]?winning|\bbrand\b|reviews?\b|\bstars?\b|rating|trusted|global leader|★|money[- ]back|guarantee|subscribe|newsletter|cookie|privacy|terms|all rights reserved)/i;
  const POSTAL = /(\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b|\b\d{5}(-\d{4})?\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b)/; // UK, US ZIP, Canada
  // Street number may be a range ("167-169") and have an optional unit prefix.
  const STREET = /\d{1,5}(?:[-–]\d{1,5})?\s+[A-Za-z0-9][\w .,'’\-]{3,60}?\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|suite|ste\.?|floor|fl\.?|blvd|boulevard|way|court|ct\.?|unit|place|pl\.?)\b/i;
  const CITYCOUNTRY = /\b(usa|u\.s\.a|united states|uk|u\.k|united kingdom|canada|london|miami|montreal|florida|quebec|qc)\b/i;
  const addFrom = (text) => {
    if (!text) return;
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || JUNK.test(t)) return;
    const sm = t.match(STREET);
    if (!sm) return;
    const start = t.indexOf(sm[0]);
    let line = t.slice(start);
    // Prefer cutting right AFTER a postal code (clean end of an address); else
    // cut at the first phone number or a second street-number start.
    const pm = line.match(POSTAL);
    const isUsZip = pm && /^\d{5}(-\d{4})?$/.test(pm[0]);
    if (pm && !isUsZip) {
      // UK/Canada: postal code sits at the END — cut just after it, keeping a
      // trailing country word ("… W1W 5PF, UK").
      const after = line.slice(line.indexOf(pm[0]) + pm[0].length);
      const tail = (after.match(/^[\s,]*([A-Za-z.]{2,20})/) || [])[1] || '';
      line = line.slice(0, line.indexOf(pm[0]) + pm[0].length) + (/(usa|uk|canada|u\.s|u\.k|united)/i.test(tail) ? ', ' + tail.trim() : '');
    } else {
      // US ZIP comes before the city, OR no postal code — cut at the first phone
      // number or a second street-number start so we keep the city/state/country.
      const phoneCut = line.slice(1).search(/(\+?\d[\d().\-]{6,})/);
      const secondStreet = line.slice(sm[0].length).search(/\b\d{1,5}\s+[A-Za-z].{0,20}\b(street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|suite|floor|blvd|boulevard|way|court|unit|place)\b/i);
      let cut = line.length;
      if (phoneCut > 10) cut = Math.min(cut, phoneCut + 1);
      if (secondStreet > 0) cut = Math.min(cut, sm[0].length + secondStreet);
      line = line.slice(0, cut);
    }
    line = line.replace(/^[A-Za-z]{2,6}[:.]\s*/, '').replace(/[\s,·•|]+$/, '').replace(/\s{2,}/g, ' ').trim();
    if (line.length > 120) line = line.slice(0, 120).trim();
    if (line.length < 10) return;
    if (!POSTAL.test(line) && !CITYCOUNTRY.test(line)) return;
    if (JUNK.test(line)) return;
    napAddresses.push(line);
    pageNap.addresses.push(line);
  };
  // 1) semantic <address> tags, 2) tidy contact blocks, 3) footer fallback.
  $('address, .footer-address, .address, .contact-info, .contact').each((_, el) => addFrom($(el).text()));
  if (!napAddresses.length) {
    $('footer div, footer p, footer li, footer span').each((_, el) => { const t = $(el).text(); if (t && t.length <= 160) addFrom(t); });
  }
  if (!napAddresses.length) footerText.split(/\s{2,}|·|•|\|/).forEach(addFrom);
  // Dedupe addresses, keeping the LONGEST version when one is a prefix of another
  // (handles the truncated-vs-full duplicate case).
  const dedupeAddresses = (arr) => {
    const cleaned = uniq(arr);
    const out = [];
    for (const a of cleaned.sort((x, y) => y.length - x.length)) {
      const ak = a.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (out.some((b) => { const bk = b.toLowerCase().replace(/[^a-z0-9]/g, ''); return bk.includes(ak) || ak.includes(bk); })) continue;
      out.push(a);
    }
    return out;
  };

  const nap = {
    name: uniq(napName)[0] || (title ? (title.split(/[|\-–—]/).pop() || '').trim() : null) || null,
    phones: uniq(napPhones).slice(0, 5),
    emails: uniq(napEmails).slice(0, 5),
    addresses: dedupeAddresses(napAddresses).slice(0, 5),
  };
  nap.present = !!(nap.name || nap.phones.length || nap.emails.length || nap.addresses.length);

  // ---- Brand-name consistency: compare the brand as written in different
  // places (title, logo alt, footer, og:site_name) and flag case/spelling
  // variants of the same name (e.g. "Oil Chef" vs footer "OiL Chef"). --------
  const ogSiteName = $('meta[property="og:site_name"]').attr('content') || '';
  const logoAlt = $('header img[alt], .logo img[alt], a[href="/"] img[alt]').first().attr('alt') || '';
  const titleBrand = (title.split(/[|\-–—]/).pop() || '').trim();
  const footerBrandM = footerText.match(/(?:©|copyright)\s*\d{0,4}\s*([A-Za-z][A-Za-z .&'’]{2,40})/i);
  const footerBrand = footerBrandM ? footerBrandM[1].trim().replace(/\s+(all rights.*|inc\.?|ltd\.?|llc).*/i, '').trim() : '';
  if (footerBrand) pageNap.names.push(footerBrand);
  if (logoAlt) pageNap.names.push(logoAlt.trim());
  const brandCandidates = [titleBrand, ogSiteName, logoAlt, footerBrand].map((s) => String(s || '').trim()).filter((s) => s && s.length >= 2 && s.length <= 40);
  // Group by lowercased form; a case/spacing variant across sources is the flag.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNorm = {};
  for (const b of brandCandidates) { const k = norm(b); (byNorm[k] = byNorm[k] || []).push(b); }
  const brandVariants = Object.values(byNorm).map((arr) => [...new Set(arr)]).filter((arr) => arr.length > 1);
  const schemaBrand = uniq(schemaNap.names)[0] || '';

  // ---- Schema vs page NAP mismatch detection. We compare what the structured
  // data (JSON-LD) declares against what the human-visible page (footer, contact
  // block, logo, title) actually shows. Three findings a report should surface:
  //   • hasSchema      — is there any Organization/LocalBusiness schema at all?
  //   • napInSchema    — does that schema actually carry name/phone/address?
  //   • brandMismatch  — schema org name ≠ the brand shown in footer/logo/title
  //   • addressMismatch— schema address absent while the page clearly shows one
  //   • phoneMismatch  — schema phone absent while the page clearly shows one
  const orgSchema = schemaNodes.some((n) => [].concat(n['@type'] || []).some((t) => /organization|localbusiness|store|restaurant|corporation/i.test(String(t))));
  const soft = (s) => String(s || '').toLowerCase().replace(/\b(inc|ltd|llc|corp|co|the|company|limited)\b/g, '').replace(/[^a-z0-9]/g, '');
  const sameName = (a, b) => { const x = soft(a), y = soft(b); return x && y && (x === y || x.includes(y) || y.includes(x)); };
  const pageBrand = footerBrand || logoAlt || titleBrand || '';
  let brandMismatch = null; // { schema, page } when they disagree
  if (schemaBrand && pageBrand && !sameName(schemaBrand, pageBrand)) brandMismatch = { schema: schemaBrand, page: pageBrand };
  const napSchemaFlags = {
    hasOrgSchema: orgSchema,
    napInSchema: !!(schemaNap.names.length || schemaNap.phones.length || schemaNap.addresses.length),
    schemaName: schemaBrand || null,
    pageName: pageBrand || null,
    schemaAddresses: dedupeAddresses(schemaNap.addresses).slice(0, 5),
    pageAddresses: dedupeAddresses(pageNap.addresses).slice(0, 5),
    schemaPhones: uniq(schemaNap.phones).slice(0, 5),
    pagePhones: uniq(pageNap.phones).slice(0, 5),
    brandMismatch,
    addressMismatch: !schemaNap.addresses.length && !!pageNap.addresses.length,
    phoneMismatch: !schemaNap.phones.length && !!pageNap.phones.length,
    // Address value mismatch: schema HAS an address but it doesn't match any page address.
    addressValueMismatch: !!(schemaNap.addresses.length && pageNap.addresses.length) &&
      !schemaNap.addresses.some((sa) => pageNap.addresses.some((pa) => { const x = soft(sa), y = soft(pa); return x && y && (x.includes(y) || y.includes(x)); })),
  };
  nap.schema = napSchemaFlags;
  const brand = { candidates: [...new Set(brandCandidates)], variants: brandVariants, primary: titleBrand || ogSiteName || footerBrand || '', schemaName: schemaBrand || null, pageName: pageBrand || null, mismatch: brandMismatch };

  const ogImage = $('meta[property="og:image"]').attr('content') || '';

  return {
    finalUrl: res.url,
    statusCode: res.status,
    readerFallbackUsed: readerUsed,
    https: res.url.startsWith('https://'),
    responseMs,
    // Raw markup, used by the AI business brief to extract NAP and social
    // links. Not part of the audit scoring.
    html,
    htmlBytes: Buffer.byteLength(html),
    title,
    titleLength: title.length,
    metaDescription: metaDesc,
    metaDescriptionLength: metaDesc.length,
    h1s,
    h1Count: h1s.length,
    h2s,
    serviceSignals: serviceSignals.slice(0, 60),
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
    social: socialLinks,
    socialNetworks,
    externalLinks: external,
    bodyTextSample: bodyText.slice(0, 3000),
    tracking,
    nap,
    brand,
    ogImage: ogImage ? (() => { try { return new URL(ogImage, url.origin).href; } catch { return ogImage; } })() : '',
    htmlTextRatio: html.length ? Number((bodyText.length / html.length).toFixed(3)) : null,
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

async function checkSitemap(website, robots, providedUrl) {
  const url = normaliseUrl(website);
  const locs = (xml) => (xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || []).map((m) => m.replace(/<\/?loc>/gi, '').trim());
  const isIndex = (xml) => /<sitemapindex[\s>]/i.test(xml);

  const candidates = [];
  if (providedUrl) candidates.push(providedUrl);
  if (robots.sitemapUrls && robots.sitemapUrls.length) candidates.push(...robots.sitemapUrls);
  candidates.push(`${url.origin}/sitemap_index.xml`, `${url.origin}/sitemap.xml`);

  for (const c of [...new Set(candidates)]) {
    try {
      const res = await fetchWithTimeout(c, 12000);
      if (!res.ok) continue;
      const xml = await res.text();
      // A sitemap INDEX lists child sitemaps, not pages — fetch each child and
      // count the real <url><loc> entries across all of them (capped for safety).
      if (isIndex(xml)) {
        const children = locs(xml).slice(0, 25);
        let total = 0;
        const pageUrls = [];
        for (const child of children) {
          try {
            const cr = await fetchWithTimeout(child, 12000);
            if (!cr.ok) continue;
            const cxml = await cr.text();
            const u = locs(cxml);
            total += u.length;
            for (const p of u) if (pageUrls.length < 2000) pageUrls.push(p);
          } catch { /* skip a bad child sitemap */ }
        }
        return { exists: true, url: c, isIndex: true, childSitemaps: children.length, urlCount: total, pageUrls };
      }
      // A plain urlset: its <loc> entries are the pages.
      const pageUrls = locs(xml);
      return { exists: true, url: c, isIndex: false, childSitemaps: 0, urlCount: pageUrls.length, pageUrls: pageUrls.slice(0, 2000) };
    } catch { /* try next candidate */ }
  }
  return { exists: false, url: null, isIndex: false, childSitemaps: 0, urlCount: 0, pageUrls: [] };
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
async function runTechnicalAudit(website, pageSpeedKey, opts = {}) {
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

  // `opts.sitemapUrl` = a sitemap the user supplied; `opts.noSitemap` = user
  // confirmed there is none, so skip the lookup entirely.
  const sitemap = opts.noSitemap
    ? { exists: false, url: null, isIndex: false, childSitemaps: 0, urlCount: 0, pageUrls: [], userConfirmedNone: true }
    : await settle(() => checkSitemap(website, robots, opts.sitemapUrl), { exists: false, urlCount: 0, pageUrls: [] });

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

// ---------------------------------------------------------------------------
// Brand-asset harvester for the Brand Guideline report. Works on already-
// fetched HTML (so it reuses the same crawl, no extra request to the homepage)
// and pulls the REAL images, colour palette and fonts the site actually uses.
//   images  — [{ url, alt, kind }]  kind: hero|product|lifestyle|og|gallery
//   colors  — [{ hex, rgb, count, role }]  role: brand|accent|dark|light|neutral
//   fonts   — ["Raleway", "Arial", ...]  from CSS font-family + Google Fonts
// baseUrl is used to resolve relative image paths to absolute URLs.
// ---------------------------------------------------------------------------
function harvestBrandAssets(html, baseUrl) {
  const out = { images: [], colors: [], fonts: [], logo: '' };
  if (!html) return out;
  let $;
  try { $ = cheerio.load(html); } catch { return out; }
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return ''; } };
  const srcOf = (el) => $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || firstFromSrcset($(el).attr('srcset')) || firstFromSrcset($(el).attr('data-srcset'));

  // JUNK: ad/related-product widgets, placeholders, tracking pixels, sprites,
  // text-only promo banners, and stock "no image" graphics. These are what made
  // the earlier reports look unsendable (Kryptonite lock, "NO IMAGE AVAILABLE").
  const JUNK_IMG = /(no[-_ ]?image|placeholder|coming[-_ ]?soon|default|avatar|spinner|loading|loader|pixel|blank|spacer|1x1|sprite|badge|payment|visa|mastercard|paypal|stripe|amex|trust|seal|star|rating|review|ad[-_]|advert|banner[-_]?ad|related|recommend|cross[-_]?sell|upsell|thumb_|_thumb|icon)/i;
  const okExt = (u) => /\.(jpe?g|png|webp|avif)(\?|$)/i.test(u) || !/\.[a-z0-9]{2,5}(\?|$)/i.test(u); // allow extensionless CDN urls
  const goodImg = (u) => u && !/^data:/i.test(u) && !/\.svg(\?|$)/i.test(u) && !/favicon/i.test(u) && okExt(u) && !JUNK_IMG.test(u);

  // --- LOGO: the real site logo (wordmark), not a favicon. Try, in order:
  //   og:logo / schema logo, then <img> whose alt/class/src says "logo" inside
  //   a header/nav/brand link, then the first header image. Reject tiny or .ico.
  const pickLogo = () => {
    const cand = [];
    const sl = $('meta[property="og:logo"]').attr('content') || $('meta[itemprop="logo"]').attr('content');
    if (sl) cand.push(sl);
    // schema.org logo
    try { $('script[type="application/ld+json"]').each((_, el) => { const j = JSON.parse($(el).contents().text()); const walk = (n) => { if (!n) return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n === 'object') { if (n.logo) cand.push(typeof n.logo === 'string' ? n.logo : (n.logo.url || '')); Object.values(n).forEach((v) => v && typeof v === 'object' && walk(v)); } }; walk(j); }); } catch {}
    // explicit logo images
    $('img').each((_, el) => {
      const s = srcOf(el); if (!s) return;
      const alt = ($(el).attr('alt') || '').toLowerCase();
      const cls = ($(el).attr('class') || '').toLowerCase();
      const idd = ($(el).attr('id') || '').toLowerCase();
      const parentCls = ($(el).parent().attr('class') || '').toLowerCase() + ' ' + ($(el).closest('a,div').attr('class') || '').toLowerCase();
      if (/logo|brand|wordmark/.test(alt + ' ' + cls + ' ' + idd + ' ' + parentCls) || /logo|wordmark/i.test(s)) cand.push(s);
    });
    // header/brand-link first image as a last resort
    const hdr = srcOf($('header a[href="/"] img, header .logo img, nav .logo img, a.navbar-brand img, header img').first());
    if (hdr) cand.push(hdr);
    for (let c of cand) {
      if (!c) continue; c = abs(c);
      if (!c || /favicon|\.ico(\?|$)/i.test(c)) continue;
      if (/sz=\d{1,2}\b/.test(c)) continue; // google favicon service with tiny size
      return c;
    }
    return '';
  };
  out.logo = pickLogo();
  const logoUrl = out.logo;

  // Skip images inside related/recommended/upsell/ad/footer widgets — those
  // pull in non-brand products (a bike lock, a motor controller, etc.).
  const inJunkContainer = (el) => {
    let n = el; let hops = 0;
    while (n && hops < 6) {
      const c = ($(n).attr('class') || '') + ' ' + ($(n).attr('id') || '');
      if (/related|recommend|upsell|cross[-_ ]?sell|also[-_ ]?bought|you[-_ ]?may|sponsor|advert|\bads?\b|widget|sidebar|footer|cart|checkout/i.test(c)) return true;
      n = $(n).parent()[0]; hops++;
    }
    return false;
  };

  // --- Images: prefer large real content photos; capture src + lazy attrs.
  const seen = new Set();
  const pushImg = (rawUrl, alt, kind) => {
    const u = abs(rawUrl);
    if (!u || !goodImg(u) || seen.has(u) || u === logoUrl) return;
    seen.add(u);
    out.images.push({ url: u, alt: (alt || '').trim().slice(0, 140), kind: kind || 'gallery' });
  };
  // og:image first (usually the hero / brand shot) — but only if it's a real photo.
  const og = $('meta[property="og:image"]').attr('content') || $('meta[name="og:image"]').attr('content');
  if (og) pushImg(og, 'Primary brand image', 'og');
  // Hero: first big image in header/hero/banner/slider sections.
  $('.hero img, [class*="hero"] img, [class*="banner"] img, [class*="slide"] img, .carousel img, [class*="masthead"] img, section:first-of-type img').each((_, el) => {
    if (inJunkContainer(el)) return;
    pushImg(srcOf(el), $(el).attr('alt'), 'hero');
  });
  // Lifestyle / editorial photos (figures and content sections).
  $('figure img, article img, [class*="lifestyle"] img, [class*="gallery"] img, main img').each((_, el) => {
    if (inJunkContainer(el)) return;
    const w = parseInt($(el).attr('width') || '0', 10);
    if (w && w < 200) return;
    pushImg(srcOf(el), $(el).attr('alt'), 'lifestyle');
  });
  // Product shots last (often the weakest / most ad-like).
  $('[class*="product"] img, [class*="shop"] img, [class*="feature"] img').each((_, el) => {
    if (inJunkContainer(el)) return;
    pushImg(srcOf(el), $(el).attr('alt'), 'product');
  });
  // Anything else sizeable we haven't captured (still skipping junk containers).
  $('img').each((_, el) => {
    if (inJunkContainer(el)) return;
    const w = parseInt($(el).attr('width') || '0', 10);
    const h = parseInt($(el).attr('height') || '0', 10);
    if ((w && w < 300) || (h && h < 200)) return; // only clearly-large images here
    pushImg(srcOf(el), $(el).attr('alt'), 'lifestyle');
  });
  out.images = out.images.slice(0, 24);

  // --- Colours: count hex colours across inline styles + <style> blocks, then
  //     rank by frequency. Classify each into a role so the palette cards read
  //     like Pack Wheel's (brand / accent / dark / light / neutral).
  const cssText = ($('style').map((_, el) => $(el).text()).get().join(' ') + ' ' +
    $('[style]').map((_, el) => $(el).attr('style')).get().join(' '));
  const hexCounts = {};
  (cssText.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).forEach((h) => {
    let hex = h.toLowerCase();
    if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    hexCounts[hex] = (hexCounts[hex] || 0) + 1;
  });
  // rgb()/rgba() too.
  (cssText.match(/rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/gi) || []).forEach((m) => {
    const [r, g, b] = m.replace(/rgba?\(/i, '').split(',').map((x) => parseInt(x.trim(), 10));
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) { const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''); hexCounts[hex] = (hexCounts[hex] || 0) + 1; }
  });
  // Weight colours used on buttons / links / brand elements more heavily — those
  // are the real brand accents, even if they appear fewer times than greys.
  const brandCssBlobs = [];
  $('[class*="btn"], button, a.button, .cta, [class*="brand"], [class*="accent"], [class*="primary"]').each((_, el) => { const s = $(el).attr('style'); if (s) brandCssBlobs.push(s); });
  // CSS custom properties often name the brand colour (--primary, --brand, --accent, --color-primary).
  (cssText.match(/--[a-z-]*(primary|brand|accent|orange|main|cta)[a-z-]*\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))/gi) || []).forEach((m) => {
    const hx = (m.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/) || [])[0];
    if (hx) { let h = hx.toLowerCase(); if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; hexCounts[h] = (hexCounts[h] || 0) + 10; }
  });
  (brandCssBlobs.join(' ').match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g) || []).forEach((h) => { let hx = h.toLowerCase(); if (hx.length === 4) hx = '#' + hx[1] + hx[1] + hx[2] + hx[2] + hx[3] + hx[3]; hexCounts[hx] = (hexCounts[hx] || 0) + 8; });

  const luminance = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const saturation = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  // A vivid colour = saturated and in a usable mid lightness band → a brand accent.
  const isVivid = (hex) => { const s = saturation(hex), l = luminance(hex); return s > 0.45 && l > 0.2 && l < 0.72; };
  const roleFor = (hex) => { const l = luminance(hex), s = saturation(hex); if (l > 0.9) return 'light'; if (l < 0.16) return 'dark'; if (s > 0.4) return l < 0.58 ? 'brand' : 'accent'; return 'neutral'; };
  const ranked = Object.entries(hexCounts)
    .filter(([hex]) => !/#ffffff|#000000/.test(hex) || hexCounts[hex] > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([hex, count]) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return { hex: hex.toUpperCase(), rgb: `${r} ${g} ${b}`, count, role: roleFor(hex) }; });

  // GUARANTEE a vivid brand accent exists. If the ranked list has no 'brand'/
  // 'accent' colour (site was mostly grey/black/white, which collapsed the old
  // reports to invisible-grey), promote the most vivid colour we saw, or fall
  // back to a strong default so the cover bar, dark-page stats and footer are
  // always legible.
  const hasAccent = ranked.some((c) => c.role === 'brand' || c.role === 'accent');
  if (!hasAccent) {
    const vivid = Object.keys(hexCounts).filter(isVivid).sort((a, b) => hexCounts[b] - hexCounts[a])[0];
    const hex = (vivid || '#E55B2A').toUpperCase();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    ranked.unshift({ hex, rgb: `${r} ${g} ${b}`, count: 99, role: 'brand' });
  }
  out.colors = ranked.slice(0, 12);

  // --- Fonts: CSS font-family declarations + Google Fonts links.
  const fonts = new Set();
  (cssText.match(/font-family\s*:\s*([^;}"']+)/gi) || []).forEach((m) => {
    m.replace(/font-family\s*:\s*/i, '').split(',').forEach((f) => {
      const name = f.replace(/["']/g, '').trim();
      if (name && !/^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|arial|helvetica)$/i.test(name) && name.length <= 40) fonts.add(name);
    });
  });
  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    (href.match(/family=([^&:]+)/g) || []).forEach((m) => { const name = decodeURIComponent(m.replace('family=', '').replace(/\+/g, ' ')).split(':')[0].trim(); if (name) fonts.add(name); });
  });
  out.fonts = [...fonts].slice(0, 8);
  return out;
}

function firstFromSrcset(srcset) {
  if (!srcset) return '';
  return String(srcset).split(',')[0].trim().split(/\s+/)[0] || '';
}

/**
 * Multi-page crawl for the Brand Guideline: the homepage alone rarely has the
 * real product photos or the full "what we sell / who we serve" story, so we
 * also visit a handful of KEY pages (About, Products/Shop, Services, and a few
 * individual product pages found in the nav + sitemap), harvest each page's
 * images and text, and merge them. Product pages contribute PRODUCT-tagged
 * images so the product slide uses genuine product shots.
 *
 * @param {string} website   site URL
 * @param {object} home      the result of crawlHomepage(website)
 * @returns {{ pages, mergedText, mergedH1s, mergedH2s, serviceSignals, images, productImages }}
 */
async function crawlKeyPages(website, home) {
  const base = normaliseUrl(website);
  const origin = base.origin;
  const hostOf = (u) => { try { return new URL(u, origin).hostname; } catch { return ''; } };
  const abs = (u) => { try { return new URL(u, origin).href.split('#')[0]; } catch { return ''; } };

  // Classify a path so we know what a page is likely to contain.
  const RX = {
    product: /(product|shop|store|collection|catalog|item|buy|gear|equipment)/i,
    about: /(about|our-story|story|who-we-are|company|mission)/i,
    service: /(service|solution|what-we-do|offerings|features)/i,
  };
  const kindOfUrl = (u) => {
    const p = (() => { try { return new URL(u, origin).pathname.toLowerCase(); } catch { return ''; } })();
    if (RX.product.test(p)) return 'product';
    if (RX.about.test(p)) return 'about';
    if (RX.service.test(p)) return 'service';
    return 'other';
  };

  // 1) Candidate URLs from the homepage's own links.
  const $home = cheerio.load(home.html || '');
  const candidates = new Map(); // url -> kind
  $home('a[href]').each((_, el) => {
    const href = $home(el).attr('href');
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return;
    const u = abs(href);
    if (!u || hostOf(u) !== base.hostname) return;
    if (u.replace(/\/$/, '') === base.href.replace(/\/$/, '') || u === origin + '/') return; // skip homepage
    const k = kindOfUrl(u);
    if (k === 'other') return;
    if (!candidates.has(u)) candidates.set(u, k);
  });

  // 2) Add product/about/service URLs from the sitemap (covers nav gaps).
  try {
    const robots = await checkRobots(website).catch(() => ({ sitemapUrls: [] }));
    const sm = await checkSitemap(website, robots || { sitemapUrls: [] });
    for (const u of (sm.pageUrls || [])) {
      const k = kindOfUrl(u);
      if (k === 'other') continue;
      if (hostOf(u) !== base.hostname) continue;
      if (!candidates.has(u)) candidates.set(u, k);
      if (candidates.size > 60) break;
    }
  } catch { /* sitemap optional */ }

  // 3) Prioritise: a couple of about/service pages, then as many product pages
  //    as the budget allows (products carry the images we care about most).
  const byKind = (k) => [...candidates.entries()].filter(([, v]) => v === k).map(([u]) => u);
  const pick = [
    ...byKind('about').slice(0, 1),
    ...byKind('service').slice(0, 2),
    ...byKind('product').slice(0, 6),
  ].slice(0, 8);

  // 4) Fetch the chosen pages (bounded concurrency), harvest assets + text.
  const pages = [];
  const productImages = [];
  const otherImages = [];
  const textChunks = [];
  const h1s = [];
  const h2s = [];
  const seenImg = new Set((home.ogImage ? [home.ogImage] : []));
  await Promise.all(pick.map(async (u) => {
    try {
      const res = await fetchWithTimeout(u, 15000);
      if (!res.ok) return;
      const html = await res.text();
      const $ = cheerio.load(html);
      const kind = candidates.get(u) || 'other';
      // text + headings for the AI
      const $b = $('body').clone(); $b.find('script,style,noscript,nav,header,footer,svg').remove();
      const txt = $b.text().replace(/\s+/g, ' ').trim();
      if (txt) textChunks.push(`[${kind.toUpperCase()} — ${u}]\n${txt.slice(0, 1500)}`);
      $('h1').each((_, el) => { const t = $(el).text().trim(); if (t) h1s.push(t); });
      $('h2').each((_, el) => { const t = $(el).text().trim(); if (t) h2s.push(t); });
      // images via the shared harvester, tagged product/lifestyle by page kind
      const assets = harvestBrandAssets(html, res.url || u);
      for (const img of (assets.images || [])) {
        if (!img || !img.url || seenImg.has(img.url)) continue;
        seenImg.add(img.url);
        const tagged = { ...img, kind: kind === 'product' ? 'product' : (img.kind || 'lifestyle'), fromPage: u };
        (kind === 'product' ? productImages : otherImages).push(tagged);
      }
      pages.push({ url: u, kind, title: $('title').first().text().trim() });
    } catch { /* skip a failed page */ }
  }));

  return {
    pages,
    mergedText: textChunks.join('\n\n').slice(0, 6000),
    mergedH1s: [...new Set(h1s)].slice(0, 20),
    mergedH2s: [...new Set(h2s)].slice(0, 30),
    images: [...productImages, ...otherImages],   // product first
    productImages,
  };
}

module.exports = { runTechnicalAudit, crawlHomepage, getPageSpeed, checkRobots, normaliseUrl, harvestBrandAssets, crawlKeyPages };
