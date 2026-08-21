/**
 * Server-side Open Graph / Twitter Card injection for the public HTML pages
 * (careers listing, job post, careers landing). Social scrapers (LinkedIn,
 * Teams, Slack, WhatsApp, Twitter/X, Facebook) read meta tags from the initial
 * HTML response and do NOT run JavaScript, so we must inject the title, image,
 * and description into the <head> before serving the file.
 */
const fs = require('fs');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Trim a description to a scraper-friendly length on a word boundary.
function clip(s, n = 200) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

/**
 * Build the OG/Twitter meta block.
 *  opts: { title, description, image, url, siteName }
 */
function buildTags({ title, description, image, url, siteName = 'Qtonix' }) {
  const T = esc(title || 'Qtonix Careers');
  const D = esc(clip(description || 'Explore open roles and apply at Qtonix.'));
  const rows = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(siteName)}" />`,
    `<meta property="og:title" content="${T}" />`,
    `<meta property="og:description" content="${D}" />`,
    url ? `<meta property="og:url" content="${esc(url)}" />` : '',
    image ? `<meta property="og:image" content="${esc(image)}" />` : '',
    image ? `<meta property="og:image:alt" content="${T}" />` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${T}" />`,
    `<meta name="twitter:description" content="${D}" />`,
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : '',
    `<meta name="description" content="${D}" />`,
  ].filter(Boolean);
  return rows.join('\n');
}

// Read an HTML file, replace its <title> and inject the meta block right after
// <head>. Falls back to returning the raw file if anything goes wrong.
function injectIntoHtml(filePath, meta) {
  let html = fs.readFileSync(filePath, 'utf8');
  const tags = buildTags(meta);
  // Replace/insert <title>.
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(meta.title || 'Qtonix Careers')}</title>`);
  }
  // Insert the tags immediately after the opening <head> tag.
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, `$1\n${tags}`);
  } else {
    html = `${tags}\n${html}`;
  }
  return html;
}

module.exports = { buildTags, injectIntoHtml, clip, esc };
