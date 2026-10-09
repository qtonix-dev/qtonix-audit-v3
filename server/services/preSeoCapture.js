/**
 * Pre-SEO report capture: fetch the live site (reuses crawler.js) and produce the
 * auto screenshots / branded boxes, each with the issue highlighted in RED to
 * match the reference report. Degrades gracefully when no headless browser is
 * installed — those slots just fall back to "paste screenshot here".
 *
 *   homepage        real screenshot of the homepage
 *   responsive      homepage at mobile+tablet+desktop, stacked
 *   pagesource      branded code box, noindex/robots line boxed red if present
 *   robots          branded terminal box of robots.txt, missing-sitemap boxed
 *   sitemap         branded result box (found / not found)
 *   schema          branded box, "no items detected" boxed if none
 *   og              branded Open Graph preview card
 *   pagespeed_m/d   real screenshot of pagespeed.web.dev, score boxed red (if browser)
 */
const path = require('path');
const { storeBuffer } = require('./preSeoStore');

const RED = '#e5484d';

// Lazily resolve Playwright + a Chromium executable. Returns null when neither is
// available, so the caller can fall back to placeholders without crashing.
let _browserMod;
async function getChromium() {
  if (_browserMod !== undefined) return _browserMod;
  try {
    const { chromium } = require('playwright');
    _browserMod = chromium;
  } catch {
    try { const { chromium } = require('playwright-core'); _browserMod = chromium; }
    catch { _browserMod = null; }
  }
  return _browserMod;
}

async function launch() {
  const chromium = await getChromium();
  if (!chromium) return null;
  const execPath = process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  try {
    return await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(execPath ? { executablePath: execPath } : {}) });
  } catch (e) {
    console.error('[preSeoCapture] chromium launch failed:', e.message);
    return null;
  }
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Persist a PNG buffer (ImageKit if configured, else local). Returns the URL.
async function save(buf, slot, reportId) {
  const r = await storeBuffer(buf, `preseo-${reportId}-${slot}.png`);
  return r.url;
}

// Draw a red highlight box (+ optional label) over the element matching `sel`,
// then screenshot the page (or that element). Used for real page screenshots.
async function highlightAndShoot(page, { sel, label, fullElement }) {
  if (sel) {
    try {
      await page.evaluate(({ sel, label, RED }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const box = document.createElement('div');
        Object.assign(box.style, { position: 'absolute', left: (r.left + window.scrollX - 6) + 'px', top: (r.top + window.scrollY - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px', border: '3px solid ' + RED, borderRadius: '4px', zIndex: 2147483647, pointerEvents: 'none' });
        document.body.appendChild(box);
        if (label) { const l = document.createElement('div'); l.textContent = label; Object.assign(l.style, { position: 'absolute', left: (r.left + window.scrollX - 6) + 'px', top: (r.top + window.scrollY + r.height + 8) + 'px', background: RED, color: '#fff', font: '700 11px sans-serif', padding: '2px 7px', borderRadius: '3px', zIndex: 2147483647 }); document.body.appendChild(l); }
      }, { sel, label, RED });
    } catch {}
  }
  if (fullElement) { const el = await page.$(fullElement); if (el) return await el.screenshot(); }
  return await page.screenshot();
}

// Render an arbitrary HTML string to a tight PNG of its <body>.
async function shootHtml(browser, html, width = 820) {
  const page = await browser.newPage({ viewport: { width, height: 600 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('body');
  const buf = await el.screenshot();
  await page.close();
  return buf;
}

// ---- branded-box HTML builders (data-driven, red highlight on the issue) -----
function pageSourceBoxHtml(c) {
  const robots = (c.html && (c.html.match(/<meta[^>]+name=["']robots["'][^>]*>/i) || [])[0]) || null;
  const robotsBad = robots && /noindex|nofollow/i.test(robots);
  const titleTag = c.title ? `<span class="tg">&lt;title&gt;</span>${esc(c.title)}<span class="tg">&lt;/title&gt;</span>` : '';
  const canon = c.canonical ? `<span class="tg">&lt;link</span> <span class="at">rel</span>=<span class="st">"canonical"</span> <span class="at">href</span>=<span class="st">"${esc(c.canonical)}"</span> <span class="tg">/&gt;</span>` : '';
  const robotsLine = robots ? (robotsBad ? `<span class="hl">${esc(robots)}</span>` : esc(robots)) : `<span class="cm">(no meta robots tag found)</span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;background:#1e1e1e;color:#d4d4d4;font-size:13px;width:820px}
    .bar{background:#2d2d2d;padding:9px 14px;color:#9cdcfe;font-size:12px}
    .bar .d{color:#ff5f56;margin-right:3px}
    pre{padding:16px 20px;margin:0;line-height:1.75;white-space:pre-wrap;word-break:break-word}
    .hl{background:rgba(229,72,77,.14);outline:2px solid ${RED};border-radius:3px;padding:1px 3px}
    .cm{color:#6a9955}.tg{color:#569cd6}.at{color:#9cdcfe}.st{color:#ce9178}
  </style></head><body>
    <div class="bar"><span class="d">●</span><span class="d">●</span><span class="d">●</span>&nbsp;&nbsp; view-source:${esc(c.finalUrl || c.website || '')}</div>
    <pre><span class="cm">&lt;!-- extract from page source --&gt;</span>
<span class="tg">&lt;head&gt;</span>
  ...
  ${robotsLine}
  ${titleTag}
  ${canon}
  ...
<span class="tg">&lt;/head&gt;</span></pre></body></html>`;
}
function robotsBoxHtml(c) {
  const r = c.robots || {};
  const raw = r.raw || '(robots.txt not found)';
  const hasSitemap = (r.sitemapUrls || []).length > 0;
  const lines = esc(raw).split('\n').map((ln) => ln).join('\n');
  const sitemapNote = hasSitemap ? '' : `\n<span class="hl">(No Sitemap: line found)</span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;background:#1e1e1e;color:#d4d4d4;font-size:13px;width:680px}
    .bar{background:#2d2d2d;padding:9px 14px;color:#ce9178;font-size:12px}
    .bar .d{color:#ff5f56;margin-right:3px}
    pre{padding:14px 18px;margin:0;line-height:1.7;white-space:pre-wrap}
    .hl{background:rgba(229,72,77,.14);outline:2px solid ${RED};border-radius:3px;padding:1px 3px;display:inline-block}
  </style></head><body>
    <div class="bar"><span class="d">●</span><span class="d">●</span><span class="d">●</span>&nbsp;&nbsp; ${esc(c.domain || '')}/robots.txt</div>
    <pre>${lines}${sitemapNote}</pre></body></html>`;
}
function resultBoxHtml({ title, ok, lines }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;width:680px;background:#fff}
    .box{border:1px solid #e2e8f0;border-radius:10px;padding:18px 22px}
    .hd{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:800;color:#0B1020}
    .tag{font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px}
    .ok{background:#f0fdf4;color:#16a34a}.bad{background:#fef2f2;color:${RED}}
    ul{margin:12px 0 0 18px}li{font-size:13px;color:#334155;margin-bottom:5px}
    .bad-line{color:${RED};font-weight:600}
  </style></head><body><div class="box">
    <div class="hd">${esc(title)} <span class="tag ${ok ? 'ok' : 'bad'}">${ok ? 'FOUND' : 'NOT FOUND'}</span></div>
    <ul>${(lines || []).map((l) => `<li class="${l.bad ? 'bad-line' : ''}">${esc(l.text || l)}</li>`).join('')}</ul>
  </div></body></html>`;
}
function ogBoxHtml(c) {
  const hasOg = (c.ogTags || 0) > 0;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;width:560px;background:#eef2f7;padding:16px}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
    .img{height:230px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;font-weight:700;${hasOg ? 'background:#dbeafe' : `background:repeating-linear-gradient(45deg,#f8fafc,#f8fafc 10px,#f1f5f9 10px,#f1f5f9 20px);outline:3px solid ${RED};outline-offset:-3px`}}
    .meta{padding:12px 14px}.host{font-size:11px;color:#64748b;text-transform:uppercase}
    .t{font-size:14px;font-weight:800;color:#0B1020;margin-top:2px}.d{font-size:12px;color:#64748b;margin-top:3px}
    .warn{color:${RED};font-weight:800}
  </style></head><body><div class="card">
    <div class="img">${hasOg ? 'Open Graph image' : '⚠ No preview image (no og:image)'}</div>
    <div class="meta"><div class="host">${esc(c.domain || '')}</div>
      <div class="t">${hasOg ? esc(c.title || '') : '<span class="warn">No Open Graph title tag</span>'}</div>
      <div class="d">${hasOg ? esc((c.metaDescription || '').slice(0, 120)) : 'When shared on WhatsApp / Facebook / Discord, no proper preview will show.'}</div>
    </div></div></body></html>`;
}

// ---- main entry: produce all auto shots from crawl data --------------------
async function captureAuto(crawl, reportId, onStep) {
  const shots = {};
  const step = (s) => { try { onStep && onStep(s); } catch {} };
  const c = crawl || {};
  const website = c.website || (c.finalUrl) || '';

  const browser = await launch();
  const browserOk = !!browser;

  // Branded boxes don't need the live site, only a browser to rasterize them.
  try {
    if (browserOk) {
      step('Rendering technical boxes');
      shots.pagesource = { source: 'auto', url: await save(await shootHtml(browser, pageSourceBoxHtml(c)), 'pagesource', reportId), label: 'Page source — meta robots', highlighted: !!(c.html && /noindex|nofollow/i.test(c.html)) };
      shots.robots = { source: 'auto', url: await save(await shootHtml(browser, robotsBoxHtml(c), 680), 'robots', reportId), label: `${c.domain || ''}/robots.txt`, highlighted: !((c.robots && c.robots.sitemapUrls || []).length) };
      const sm = c.sitemap || {};
      shots.sitemap = { source: 'auto', url: await save(await shootHtml(browser, resultBoxHtml({ title: 'XML Sitemap', ok: !!sm.exists, lines: sm.exists ? [{ text: `Found: ${sm.url || ''}` }, { text: `${sm.urlCount || 0} URLs listed` }] : [{ text: 'No XML sitemap found at /sitemap.xml or /sitemap_index.xml', bad: true }] }), 680), 'sitemap', reportId), label: 'XML Sitemap', highlighted: !sm.exists };
      const noSchema = !c.hasSchema;
      shots.schema = { source: 'auto', url: await save(await shootHtml(browser, resultBoxHtml({ title: 'Schema / Rich Results', ok: !noSchema, lines: noSchema ? [{ text: 'No items detected', bad: true }] : (c.schemaTypes || []).map((t) => ({ text: t })) }), 680), 'schema', reportId), label: 'Rich Results Test', highlighted: noSchema };
      shots.og = { source: 'auto', url: await save(await shootHtml(browser, ogBoxHtml(c), 560), 'og', reportId), label: 'Open Graph preview', highlighted: !(c.ogTags > 0) };

      // Homepage — real screenshot. Highlight a dead "#" link if one exists.
      try {
        step('Capturing homepage');
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.4 });
        await page.goto(website, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(website, { waitUntil: 'domcontentloaded', timeout: 30000 }));
        const deadSel = await page.evaluate(() => { const a = [...document.querySelectorAll('a[href="#"],a[href=""]')][0]; if (!a) return null; a.setAttribute('data-preseo-dead', '1'); return '[data-preseo-dead="1"]'; }).catch(() => null);
        const buf = await highlightAndShoot(page, deadSel ? { sel: deadSel, label: 'links to #' } : {});
        shots.homepage = { source: 'auto', url: await save(buf, 'homepage', reportId), label: `Homepage of ${c.domain || ''}`, highlighted: !!deadSel };
        // Responsive strip
        step('Capturing mobile view');
        await page.setViewportSize({ width: 390, height: 780 });
        const mob = await page.screenshot();
        shots.responsive = { source: 'auto', url: await save(mob, 'mobile', reportId), label: 'Homepage on mobile', highlighted: false };
        await page.close();
      } catch (e) { console.error('[preSeoCapture] homepage shot failed:', e.message); }
    }
  } catch (e) { console.error('[preSeoCapture] auto capture error:', e.message); }
  finally { if (browser) await browser.close().catch(() => {}); }

  return { shots, browserAvailable: browserOk };
}

module.exports = { captureAuto };
