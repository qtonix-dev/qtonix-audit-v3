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
function buildTags({ title, description, image, url, siteName = 'Qtonix', keywords }) {
  const T = esc(title || 'Qtonix Careers');
  const D = esc(clip(description || 'Explore open roles and apply at Qtonix.'));
  const kw = Array.isArray(keywords) ? keywords.filter(Boolean).join(', ') : '';
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
    kw ? `<meta name="keywords" content="${esc(kw)}" />` : '',
  ].filter(Boolean);
  return rows.join('\n');
}

// Read an HTML file, replace its <title> and inject the meta block (and optional
// JSON-LD structured data) right after <head>. Falls back to the raw file.
function injectIntoHtml(filePath, meta) {
  let html = fs.readFileSync(filePath, 'utf8');
  const tags = buildTags(meta);
  const jsonLd = meta.jsonLd ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>` : '';
  const block = jsonLd ? `${tags}\n${jsonLd}` : tags;
  // Replace/insert <title>.
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(meta.title || 'Qtonix Careers')}</title>`);
  }
  // Insert the tags immediately after the opening <head> tag.
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, `$1\n${block}`);
  } else {
    html = `${block}\n${html}`;
  }
  return html;
}

// Build Google JobPosting structured data (https://developers.google.com/search/
// docs/appearance/structured-data/job-posting). Only includes fields we have.
function jobPostingLd(job, { url, orgName = 'Qtonix', orgUrl, logo, base } = {}) {
  const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const empMap = { full_time: 'FULL_TIME', part_time: 'PART_TIME', internship: 'INTERN', freelance: 'CONTRACTOR' };
  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: clean(job.description) || job.title,
    datePosted: (job.createdAt ? new Date(job.createdAt) : new Date()).toISOString().slice(0, 10),
    employmentType: empMap[job.employmentType] || 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: orgName, sameAs: orgUrl || base || undefined, logo: logo || undefined },
    directApply: true,
  };
  if (url) ld.url = url;
  // Locations. Remote → TELECOMMUTE; otherwise a postal address per location.
  const locs = Array.isArray(job.locations) ? job.locations.filter(Boolean) : [];
  if (job.workMode === 'remote') {
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = { '@type': 'Country', name: 'India' };
  }
  if (locs.length) {
    ld.jobLocation = locs.map((l) => ({
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: String(l).split(',')[0].trim(), addressCountry: 'IN', streetAddress: String(l) },
    }));
  } else if (job.workMode !== 'remote') {
    ld.jobLocation = [{ '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'IN' } }];
  }
  // Salary (only when present and not hidden).
  if (!job.hideSalary && (job.salaryMin || job.salaryMax)) {
    const unitMap = { hourly: 'HOUR', monthly: 'MONTH', annual: 'YEAR' };
    ld.baseSalary = {
      '@type': 'MonetaryAmount', currency: job.salaryCurrency || 'INR',
      value: { '@type': 'QuantitativeValue', minValue: job.salaryMin || undefined, maxValue: job.salaryMax || undefined, unitText: unitMap[job.salaryPeriod] || 'MONTH' },
    };
  }
  return ld;
}

// Build an ItemList of job postings for the careers listing page.
function careersItemListLd(jobs, { base } = {}) {
  return {
    '@context': 'https://schema.org/',
    '@type': 'ItemList',
    itemListElement: (jobs || []).map((j, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: base && j.publicToken ? `${base}/jobs/${j.publicToken}` : undefined,
      name: j.title,
    })),
  };
}

module.exports = { buildTags, injectIntoHtml, clip, esc, jobPostingLd, careersItemListLd };
