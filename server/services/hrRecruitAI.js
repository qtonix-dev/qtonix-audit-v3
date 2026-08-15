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

/**
 * AI Recruiter — assess how well a candidate matches the job. Returns a
 * structured verdict the UI renders (score, strengths, gaps, recommendation).
 */
async function screenCandidate(apiKey, { candidate, job }) {
  const a = candidate.answers || {};
  const skills = (a.skills || []).join(', ');
  const work = (a.work || []).map((w) => `${w.title || ''} @ ${w.company || ''} (${w.start || ''}–${w.current ? 'present' : (w.end || '')})`).join('; ');
  const edu = (a.education || []).map((e) => `${e.course || ''} ${e.specialization || ''} @ ${e.institute || ''}`).join('; ');
  const jobSkills = job ? (job.skills || []).map((s) => (typeof s === 'string' ? s : s.name)).join(', ') : '';
  const jobDesc = job ? String(job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 2500) : '';

  const out = await callClaude(apiKey, {
    system: 'You are an expert technical recruiter screening a candidate against a job. Be fair, specific and honest. Return ONLY JSON, no prose.',
    maxTokens: 1200,
    messages: [{
      role: 'user',
      content: `Assess this candidate against the role and return exactly:
{
  "matchScore": 0-100,
  "verdict": "strong_match | possible_match | weak_match",
  "summary": "2-3 sentence overall assessment",
  "strengths": ["..."],
  "gaps": ["..."],
  "recommendation": "one clear next-step recommendation"
}

ROLE
Title: ${job ? job.title : 'N/A'}
Required skills: ${jobSkills}
Experience wanted: ${job ? `${job.expMin || 0}-${job.expMax || 0} years` : 'N/A'}
Description: ${jobDesc}

CANDIDATE
Name: ${candidate.name}
Location: ${candidate.currentLocation || a.city || ''}
Skills: ${skills}
Work: ${work}
Education: ${edu}
Notice period: ${a.noticePeriod || ''}
Current/Expected CTC: ${a.currentCtc || '?'} / ${a.expectedCtc || '?'}`,
    }],
  });
  const data = parseJson(out);
  ['strengths', 'gaps'].forEach((k) => { if (!Array.isArray(data[k])) data[k] = []; });
  // Score out of 10 for a simple, HR-friendly headline number.
  data.score10 = Math.round(((Number(data.matchScore) || 0) / 10) * 10) / 10;
  data.generatedAt = new Date().toISOString();
  return data;
}

/**
 * Draft a recruitment email (Claude). HR-specific modes replace the CRM's
 * sales-oriented ones. Returns { subject, body(HTML) }.
 */
async function draftRecruitmentEmail(apiKey, { mode, prompt, candidateName, roleTitle, recruiterName, meetingWhen, meetLink }) {
  const first = String(candidateName || 'there').split(' ')[0];
  const modeInstruction = (() => {
    switch (mode) {
      case 'interview_invite':
        return `Invite ${first} to an interview for the ${roleTitle} role${meetingWhen ? ` on ${meetingWhen}` : ''}. ${meetLink ? `Include this Google Meet link: ${meetLink}.` : 'Ask them to confirm their availability.'} Warm and professional.`;
      case 'shortlist':
        return `Tell ${first} they've been shortlisted for the ${roleTitle} role and outline the next steps. Encouraging and clear.`;
      case 'assignment':
        return `Send ${first} a take-home assignment for the ${roleTitle} role. Explain the task briefly, expectations and the deadline. ${prompt ? `Details: ${prompt}` : ''}`;
      case 'offer':
        return `Send ${first} a warm offer email for the ${roleTitle} role, expressing enthusiasm and saying a formal offer letter will follow. Do NOT invent specific salary numbers unless provided.`;
      case 'rejection':
        return `Write a kind, respectful rejection to ${first} for the ${roleTitle} role. Thank them for their time, be gentle and encouraging, keep it short.`;
      case 'followup':
        return `Write a friendly follow-up to ${first} regarding their ${roleTitle} application, checking in and keeping them warm.`;
      case 'request_docs':
        return `Politely ask ${first} to share documents/details needed to proceed with the ${roleTitle} process. ${prompt ? `Specifically: ${prompt}` : ''}`;
      case 'custom':
      default:
        return prompt || `Write a professional, friendly recruitment email to ${first} regarding the ${roleTitle} role.`;
    }
  })();

  const system = [
    'You are a professional, warm recruiter writing to a candidate.',
    'Tone: friendly, respectful, clear and concise. Never pushy.',
    `Sign off as "${recruiterName || 'The Talent Team'}" on its own line after "Best regards,".`,
    'FORMATTING: body must be clean HTML — wrap each paragraph in its own <p>, use <br> for line breaks and <ul><li> for lists. Separate greeting, paragraphs and sign-off into distinct <p> tags.',
    'Return STRICT JSON: {"subject":"...","body":"<p>...</p>"}. No markdown, no <html> wrapper, no commentary.',
  ].join(' ');

  const out = await callClaude(apiKey, {
    system, maxTokens: 1100,
    messages: [{ role: 'user', content: `Candidate: ${candidateName}\nRole: ${roleTitle}\n\nTASK:\n${modeInstruction}` }],
  });
  let parsed;
  try { parsed = parseJson(out); } catch { parsed = { subject: '', body: String(out) }; }
  return { subject: parsed.subject || '', body: parsed.body || '' };
}

module.exports = { rewriteJobDescription, suggestSkills, parseUploadedJD, parseResume, extractFileText, screenCandidate, draftRecruitmentEmail };
