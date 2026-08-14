/**
 * AI helpers for the recruitment job-post builder, powered by the Claude API.
 * Reuses the shared callClaude() so usage is tracked and the key handling is
 * consistent with the rest of the app.
 *
 *   rewriteJobDescription — turn rough notes into a well-structured JD.
 *   suggestSkills         — infer a skill set from title + description.
 *   parseUploadedJD       — read an uploaded JD (text) and extract structured
 *                           fields, flagging what's missing.
 */

const { callClaude } = require('./aiVisibility');

/**
 * Extract plain text from an uploaded file (base64 data URL or raw base64).
 * Handles PDF (pdf-parse), Word .docx (mammoth) and plain text. Runs entirely
 * server-side so it doesn't depend on browser CDN modules.
 */
async function extractFileText({ base64, fileName }) {
  let b64 = String(base64 || '');
  const m = b64.match(/^data:([^;]+);base64,(.*)$/s);
  const mime = m ? m[1] : '';
  if (m) b64 = m[2];
  const buf = Buffer.from(b64, 'base64');
  const name = String(fileName || '').toLowerCase();

  if (name.endsWith('.pdf') || mime === 'application/pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buf });
    const data = await parser.getText();
    return (data && data.text) || '';
  }
  if (name.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value || '';
  }
  if (name.endsWith('.doc') || mime === 'application/msword') {
    // Legacy .doc isn't cleanly parseable; fall back to a best-effort text pull.
    return buf.toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, ' ');
  }
  // txt / rtf / unknown → treat as UTF-8 text.
  return buf.toString('utf8');
}

function parseJson(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error('No JSON in model response');
  // Take from the first bracket to the matching last one.
  const open = cleaned[start];
  const close = open === '[' ? ']' : '}';
  const end = cleaned.lastIndexOf(close);
  return JSON.parse(cleaned.slice(start, end + 1));
}

const JD_TEMPLATE_GUIDE = `Structure the description in clean HTML using this exact shape:
<p>A 2-3 sentence summary of the role: what it is, what success looks like, and how it fits into the organisation overall.</p>
<h3>Responsibilities</h3>
<ul><li>Specific, action-led responsibilities in gender-neutral, inclusive language.</li></ul>
<h3>Qualifications</h3>
<ul><li>Skills, education, experience or certifications required.</li></ul>
Use only <p>, <h3>, <ul>, <li>, <strong>, <em> tags. No markdown, no emoji, no other tags.`;

/**
 * Rewrite / format a job description into the standard structure.
 * `draft` may be rough notes or an existing description.
 */
async function rewriteJobDescription(apiKey, { title, department, draft, workMode }) {
  const text = await callClaude(apiKey, {
    system: `You are an expert technical recruiter writing job descriptions. ${JD_TEMPLATE_GUIDE} Return ONLY the HTML, nothing else.`,
    maxTokens: 1600,
    messages: [{
      role: 'user',
      content: `Job title: ${title || '(untitled)'}\nDepartment: ${department || 'n/a'}\nWork mode: ${workMode || 'n/a'}\n\nRewrite and properly format the following into a complete, compelling job description following the required structure. Expand thin sections sensibly for this role, but do not invent specific company names, salaries or benefits.\n\nDraft / notes:\n${draft || '(none provided — write a strong generic description for this title)'}`,
    }],
  });
  // Strip any stray code fences / preamble, keep the HTML.
  return String(text).replace(/```html/gi, '').replace(/```/g, '').trim();
}

/**
 * Suggest a skill set from the title + description. Returns
 * [{ name, primary }] with 6-10 skills, 1-3 flagged primary.
 */
async function suggestSkills(apiKey, { title, description }) {
  const text = await callClaude(apiKey, {
    system: 'You suggest concise, industry-standard skill tags for a job. Return ONLY a JSON array, no prose.',
    maxTokens: 500,
    messages: [{
      role: 'user',
      content: `Job title: ${title || ''}\nDescription (may be HTML): ${String(description || '').replace(/<[^>]+>/g, ' ').slice(0, 2000)}\n\nReturn 6-10 relevant skills as JSON: [{"name":"React","primary":true}, ...]. Mark the 1-3 most essential as "primary": true, the rest false. Skills should be short (1-3 words), specific and real. No duplicates.`,
    }],
  });
  const arr = parseJson(text);
  return (Array.isArray(arr) ? arr : []).slice(0, 12).map((s) => ({
    name: String(s.name || s).slice(0, 40),
    primary: !!s.primary,
  })).filter((s) => s.name);
}

/**
 * Parse an uploaded JD (already extracted to plain text) into structured
 * fields, and report which important fields could not be found.
 */
async function parseUploadedJD(apiKey, { text }) {
  const raw = String(text || '').slice(0, 12000);
  const out = await callClaude(apiKey, {
    system: 'You extract structured job-post data from a raw job description. Return ONLY JSON matching the requested schema, nothing else.',
    maxTokens: 1800,
    messages: [{
      role: 'user',
      content: `From the job description below, extract this JSON exactly:
{
  "title": "",
  "department": "",
  "workMode": "in_office | hybrid | remote | ''",
  "locations": [],
  "description": "well-formatted HTML using <p>,<h3>,<ul>,<li> with a summary, Responsibilities and Qualifications sections",
  "skills": [{"name":"","primary":false}],
  "salaryMin": null, "salaryMax": null, "salaryPeriod": "monthly|annual|hourly|''", "salaryCurrency": "",
  "experienceType": "freshers|intern|experienced|''", "expMin": null, "expMax": null,
  "employmentType": "full_time|part_time|internship|freelance|''",
  "employmentLevel": "entry|associate|mid_senior|senior|tl|manager|''",
  "education": "", "openings": null,
  "missing": ["list the human-readable names of important fields you could NOT find, e.g. 'Salary range', 'Location'"]
}
Use empty string / null / [] when a field is not present, and add that field's name to "missing". Do not invent salaries, locations or company specifics. Reformat the description into clean HTML even if the original was plain text.

JOB DESCRIPTION:
${raw}`,
    }],
  });
  const data = parseJson(out);
  if (!Array.isArray(data.missing)) data.missing = [];
  if (!Array.isArray(data.skills)) data.skills = [];
  if (!Array.isArray(data.locations)) data.locations = [];
  return data;
}

/**
 * Parse a candidate's resume (already extracted to plain text) into the fields
 * the Add Candidate form uses. Everything is best-effort; the HR reviews/edits.
 */
async function parseResume(apiKey, { text }) {
  const raw = String(text || '').slice(0, 14000);
  const out = await callClaude(apiKey, {
    system: 'You extract structured candidate data from a resume. Return ONLY JSON matching the requested schema, nothing else. Never invent data that is not present — use empty string / null / [] instead.',
    maxTokens: 1800,
    messages: [{
      role: 'user',
      content: `From the resume below, extract this JSON exactly:
{
  "firstName": "", "lastName": "", "email": "", "phone": "",
  "currentCtc": "", "expectedCtc": "", "noticePeriod": "",
  "currentLocation": "", "address": "", "country": "", "state": "", "city": "",
  "dob": "", "gender": "", "maritalStatus": "",
  "linkedin": "", "github": "", "portfolio": "", "twitter": "", "facebook": "", "instagram": "",
  "skills": ["skill1","skill2"],
  "workExperience": [{"company":"","title":"","start":"","end":"","current":false}],
  "education": [{"type":"","course":"","specialization":"","institute":"","start":"","end":""}]
}
Extract only what the resume actually contains. Phone should include country code if present. Dates as written. Return valid JSON only.

RESUME:
${raw}`,
    }],
  });
  const data = parseJson(out);
  ['skills', 'workExperience', 'education'].forEach((k) => { if (!Array.isArray(data[k])) data[k] = []; });
  return data;
}

module.exports = { rewriteJobDescription, suggestSkills, parseUploadedJD, parseResume, extractFileText };
