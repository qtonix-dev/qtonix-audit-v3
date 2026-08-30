/**
 * Job/careers share metadata:
 *  - AI-written OG title + description (OpenAI, cached on the job record).
 *  - A branded 1200x630 OG image (blue box + centered Qtonix logo, safe margins)
 *    so social cards never crop the logo.
 *
 * The image is generated once and cached on disk under storage/og/. Both the
 * job posts and the careers listing share the same branded image.
 */
const fs = require('fs');
const path = require('path');

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_META_MODEL || 'gpt-4o-mini';

const OG_DIR = path.join(__dirname, '..', '..', 'storage', 'og');
function ensureDir() { try { fs.mkdirSync(OG_DIR, { recursive: true }); } catch {} }

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

async function callOpenAI(apiKey, { system, user, maxTokens = 400 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
        max_tokens: maxTokens, temperature: 0.5,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } finally { clearTimeout(timer); }
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/**
 * Generate an OG title + description for a single job post. Returns
 * { title, description } — falls back to sensible non-AI values on any error.
 */
async function generateJobMeta(job, apiKey) {
  const loc = Array.isArray(job.locations) && job.locations.length ? job.locations.join(', ') : (job.branch || '');
  const empMap = { full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', freelance: 'Freelance' };
  const modeMap = { in_office: 'In office', hybrid: 'Hybrid', remote: 'Remote' };
  const facts = {
    title: job.title, department: job.department || '', location: loc,
    employmentType: empMap[job.employmentType] || job.employmentType || '',
    workMode: modeMap[job.workMode] || job.workMode || '',
    experience: job.experienceType || '',
    skills: (Array.isArray(job.skills) ? job.skills : []).map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean).slice(0, 8),
    descriptionExcerpt: stripHtml(job.description).slice(0, 900),
  };
  // Sensible fallbacks (used if no key or the call fails).
  const fallback = {
    title: `${job.title}${facts.department ? ` — ${facts.department}` : ''}${loc ? ` · ${loc}` : ''} | Qtonix Careers`.slice(0, 195),
    description: (stripHtml(job.description) || `Join Qtonix as ${job.title}${loc ? ` in ${loc}` : ''}. Apply now.`).slice(0, 300),
  };
  if (!apiKey) return fallback;
  try {
    const system = 'You write concise, compelling Open Graph share metadata for job posts. Return STRICT JSON only, no markdown. Keys: "title" (<=90 chars, include the role and — if available — the location; do NOT add the company suffix, it is appended separately), "description" (<=180 chars, highlight the most attractive facts: role, location, work mode, top 2-3 skills or responsibilities; energetic but professional; no hashtags, no emojis).';
    const user = `Write share metadata for this job. Facts:\n${JSON.stringify(facts, null, 2)}`;
    const out = await callOpenAI(apiKey, { system, user, maxTokens: 300 });
    const j = parseJson(out);
    if (j && (j.title || j.description)) {
      const title = String(j.title || job.title).replace(/\s+/g, ' ').trim().slice(0, 120);
      const description = String(j.description || fallback.description).replace(/\s+/g, ' ').trim().slice(0, 300);
      return { title: `${title} | Qtonix Careers`.slice(0, 195), description };
    }
  } catch (e) { console.error('[jobMeta] AI generate failed:', e.message); }
  return fallback;
}

/**
 * Generate an OG title + description for the whole careers listing.
 */
async function generateCareersMeta(jobs, branding, apiKey) {
  const roles = (jobs || []).map((j) => j.title).filter(Boolean).slice(0, 15);
  const fallback = {
    title: (branding && branding.title ? `${branding.title} | Qtonix Careers` : 'Careers at Qtonix — Open Roles'),
    description: `Explore ${roles.length || 'our'} open roles at Qtonix and find your next opportunity. Apply today.`.slice(0, 300),
  };
  if (!apiKey || roles.length === 0) return fallback;
  try {
    const system = 'You write concise Open Graph share metadata for a company careers page that lists multiple open roles. Return STRICT JSON only. Keys: "title" (<=80 chars, do NOT add a company suffix, it is appended separately), "description" (<=180 chars, invite candidates and mention the breadth of roles/teams; professional; no emojis, no hashtags).';
    const user = `Company: Qtonix. Open roles:\n${roles.join(', ')}`;
    const out = await callOpenAI(apiKey, { system, user, maxTokens: 220 });
    const j = parseJson(out);
    if (j && (j.title || j.description)) {
      const title = String(j.title || 'Careers at Qtonix').replace(/\s+/g, ' ').trim().slice(0, 110);
      const description = String(j.description || fallback.description).replace(/\s+/g, ' ').trim().slice(0, 300);
      return { title: `${title} | Qtonix Careers`.slice(0, 195), description };
    }
  } catch (e) { console.error('[jobMeta] careers AI failed:', e.message); }
  return fallback;
}

/**
 * Build (and cache) the branded 1200x630 OG image: a blue rounded box on a light
 * canvas with the Qtonix logo centered inside it and generous margins so the
 * logo is never cut. Returns the absolute filesystem path, or null on failure.
 *
 * logoDataUrl: a data: URL or absolute URL to the logo (from careers branding).
 */
async function buildOgImage(logoSrc) {
  ensureDir();
  const outPng = path.join(OG_DIR, 'share.png');
  try {
    // Resolve the logo into an <img src> the renderer can use. Data URLs and
    // http(s) URLs both work in WeasyPrint.
    const logo = logoSrc && /^(data:|https?:)/i.test(logoSrc) ? logoSrc : '';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: 1200px 630px; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1200px; height: 630px; }
      .canvas { width: 1200px; height: 630px; background: #F4F7FE; display: flex; align-items: center; justify-content: center; }
      /* Blue box with the logo centered and safe padding on all sides. */
      .box { width: 1040px; height: 470px; background: #0A0E28; border-radius: 36px;
             display: flex; align-items: center; justify-content: center; padding: 90px; }
      .box img { max-width: 100%; max-height: 100%; object-fit: contain; }
      .fallback { color: #fff; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; font-size: 120px; font-weight: 800; letter-spacing: -2px; }
    </style></head><body>
      <div class="canvas"><div class="box">
        ${logo ? `<img src="${logo}" alt="Qtonix" />` : `<div class="fallback">Qtonix</div>`}
      </div></div>
    </body></html>`;
    const tmpHtml = path.join(OG_DIR, '_share.html');
    fs.writeFileSync(tmpHtml, html);
    // Render HTML -> PNG. Prefer WeasyPrint (already used in this project) via
    // PDF, then convert to PNG with pdftoppm; fall back to weasyprint PNG.
    const { execFileSync } = require('child_process');
    const tmpPdf = path.join(OG_DIR, '_share.pdf');
    let made = false;
    try {
      execFileSync('python3', ['-c', `from weasyprint import HTML; HTML('${tmpHtml}').write_pdf('${tmpPdf}')`], { timeout: 60000, stdio: 'ignore' });
      execFileSync('pdftoppm', ['-png', '-r', '96', '-singlefile', '-scale-to-x', '1200', '-scale-to-y', '630', tmpPdf, outPng.replace(/\.png$/, '')], { timeout: 60000, stdio: 'ignore' });
      made = fs.existsSync(outPng);
    } catch (e) { console.error('[jobMeta] weasyprint render failed:', e.message); }
    try { fs.unlinkSync(tmpHtml); } catch {}
    try { fs.unlinkSync(tmpPdf); } catch {}
    return made ? outPng : null;
  } catch (e) { console.error('[jobMeta] buildOgImage failed:', e.message); return null; }
}

function ogImagePath() { return path.join(OG_DIR, 'share.png'); }

/**
 * Generate a SEARCH-optimized page title + meta description for a single job's
 * public page. Distinct from the OG (social share) meta: SEO copy is written to
 * rank — it front-loads the role and location (local-search intent) and keeps
 * the title within Google's ~60-char display limit and the description within
 * ~155 chars. Returns { title, description }; falls back without AI.
 */
async function generateJobSeo(job, apiKey) {
  const allLocs = Array.isArray(job.locations) ? job.locations.map((l) => String(l).split(',')[0].trim()).filter(Boolean) : [];
  const loc = allLocs[0] || job.branch || '';
  const empMap = { full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', freelance: 'Freelance' };
  const modeMap = { in_office: 'In office', hybrid: 'Hybrid', remote: 'Remote' };
  const levelMap = { entry: 'Entry level', associate: 'Associate', mid_senior: 'Mid-Senior', senior: 'Senior', tl: 'Team Lead', manager: 'Manager' };
  const skills = (Array.isArray(job.skills) ? job.skills : []).map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean).slice(0, 10);
  const fallbackTitle = `${job.title}${loc ? ` in ${loc}` : ''} | Qtonix Careers`.slice(0, 60);
  const fallbackDesc = (`Apply for ${job.title}${loc ? ` in ${loc}` : ''} at Qtonix. ${modeMap[job.workMode] || ''} ${empMap[job.employmentType] || ''} role. Join our team — apply online today.`).replace(/\s+/g, ' ').trim().slice(0, 155);
  const fallback = { title: fallbackTitle, description: fallbackDesc, keywords: [job.title, loc && `${job.title} jobs in ${loc}`, 'Qtonix careers', ...skills.slice(0, 3)].filter(Boolean) };
  if (!apiKey) return fallback;
  try {
    // Give the model the FULL picture so it can write compelling, keyword-rich
    // copy: the actual job description (not just the title), every location, the
    // seniority, work mode, and salary signal. The richer the input, the better
    // the ranking copy.
    const facts = {
      role: job.title,
      department: job.department || '',
      locations: allLocs,
      primaryLocation: loc,
      workMode: modeMap[job.workMode] || '',
      employmentType: empMap[job.employmentType] || '',
      seniority: levelMap[job.employmentLevel] || '',
      experience: job.experienceType || '',
      topSkills: skills,
      salaryVisible: !job.hideSalary && (job.salaryMin || job.salaryMax) ? `${job.salaryCurrency || 'INR'} ${job.salaryMin || ''}-${job.salaryMax || ''}/${job.salaryPeriod || 'month'}` : '',
      jobDescription: stripHtml(job.description).slice(0, 1600),
    };
    const system = [
      'You are a senior SEO copywriter for a company careers site. You write metadata for ONE job posting that RANKS on Google for candidates searching that role + location, and that is compelling enough to earn the click.',
      'Study the full job description provided and extract the real hook (the most attractive responsibility, tech, or benefit).',
      'Return STRICT JSON only, no markdown. Keys:',
      '"title": <=60 characters INCLUDING a " | Qtonix" style suffix you MUST include. Front-load the EXACT role name, then the city if available (local-search intent). Use natural search phrasing candidates type, e.g. "Senior React Developer Jobs in Pune".',
      '"description": <=155 characters. Naturally include the role, the location, ONE concrete draw pulled from the job description (a key technology, responsibility, or benefit), and end with a call to action ("Apply now", "Apply online"). Persuasive but professional. No emojis, no hashtags, no quotes.',
      '"keywords": an array of 5-8 short search phrases a candidate would actually type to find this job (include role synonyms, "[role] jobs in [city]", seniority, and 1-2 key skills). Lowercase.',
    ].join(' ');
    const user = `Write SEO metadata for this job. Base the hook on the jobDescription, not just the title.\n${JSON.stringify(facts, null, 2)}`;
    const out = await callOpenAI(apiKey, { system, user, maxTokens: 320 });
    const j = parseJson(out);
    if (j && (j.title || j.description)) {
      let title = String(j.title || fallback.title).replace(/\s+/g, ' ').trim();
      if (!/qtonix/i.test(title)) title = `${title} | Qtonix`;
      title = title.slice(0, 60);
      const description = String(j.description || fallback.description).replace(/\s+/g, ' ').trim().slice(0, 160);
      const keywords = Array.isArray(j.keywords) ? j.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 10) : fallback.keywords;
      return { title, description, keywords };
    }
  } catch (e) { console.error('[jobMeta] SEO generate failed:', e.message); }
  return fallback;
}

/**
 * Generate a search-optimized title + meta description for the careers landing
 * page (lists all roles). Returns { title, description }.
 */
async function generateCareersSeo(jobs, branding, apiKey) {
  const list = (jobs || []).slice(0, 20);
  const roles = list.map((j) => j.title).filter(Boolean).slice(0, 15);
  const departments = [...new Set(list.map((j) => j.department).filter(Boolean))].slice(0, 8);
  const locations = [...new Set(list.flatMap((j) => (Array.isArray(j.locations) ? j.locations : []).map((l) => String(l).split(',')[0].trim())).filter(Boolean))].slice(0, 6);
  const fallback = {
    title: 'Careers at Qtonix — Open Jobs & Roles'.slice(0, 60),
    description: `Explore ${roles.length || 'our'} open roles at Qtonix across ${departments.slice(0, 3).join(', ') || 'engineering, sales and design'}. Find your next job and apply online today.`.replace(/\s+/g, ' ').trim().slice(0, 155),
    keywords: ['qtonix careers', 'qtonix jobs', 'jobs at qtonix', ...departments.map((d) => `${d.toLowerCase()} jobs`).slice(0, 3), ...locations.map((l) => `jobs in ${l.toLowerCase()}`).slice(0, 2)].filter(Boolean),
  };
  if (!apiKey || roles.length === 0) return fallback;
  try {
    // Feed the model the actual open positions with short JD excerpts, the
    // departments and the cities, so the landing-page copy reflects what's truly
    // being hired for and ranks for those role/location searches.
    const positions = list.slice(0, 12).map((j) => ({ title: j.title, department: j.department || '', location: (Array.isArray(j.locations) && j.locations[0]) ? String(j.locations[0]).split(',')[0].trim() : '', excerpt: stripHtml(j.description || '').slice(0, 220) }));
    const system = [
      'You are a senior SEO copywriter. Write search-optimized metadata for a company CAREERS landing page that lists multiple open roles. It should rank for "[company] careers", "[company] jobs", and the key role/department searches, and invite applications.',
      'Return STRICT JSON only. Keys:',
      '"title": <=60 chars, MUST include "Qtonix" and a word like Careers or Jobs; hint at the breadth (e.g. teams or seniority) where it fits.',
      '"description": <=155 chars; mention hiring across the real departments/teams shown, reference a city or "remote" if present, invite applications, end with a call to action. No emojis, no hashtags.',
      '"keywords": 5-8 lowercase search phrases (include "qtonix careers", "qtonix jobs", the main departments as "[dept] jobs", and 1-2 "[role] jobs" or "jobs in [city]").',
    ].join(' ');
    const user = `Company: Qtonix.\nDepartments hiring: ${departments.join(', ') || 'various'}\nLocations: ${locations.join(', ') || 'various'}\nOpen positions:\n${JSON.stringify(positions, null, 2)}`;
    const out = await callOpenAI(apiKey, { system, user, maxTokens: 320 });
    const j = parseJson(out);
    if (j && (j.title || j.description)) {
      let title = String(j.title || fallback.title).replace(/\s+/g, ' ').trim();
      if (!/qtonix/i.test(title)) title = `Qtonix — ${title}`;
      title = title.slice(0, 60);
      const description = String(j.description || fallback.description).replace(/\s+/g, ' ').trim().slice(0, 160);
      const keywords = Array.isArray(j.keywords) ? j.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 10) : fallback.keywords;
      return { title, description, keywords };
    }
  } catch (e) { console.error('[jobMeta] careers SEO failed:', e.message); }
  return fallback;
}

module.exports = { generateJobMeta, generateCareersMeta, generateJobSeo, generateCareersSeo, buildOgImage, ogImagePath, stripHtml };
