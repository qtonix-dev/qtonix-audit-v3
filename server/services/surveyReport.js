/**
 * Survey report renderer: Handlebars -> HTML -> WeasyPrint -> PDF.
 * Matches the Site Analysis proposal design language (US Letter, navy→blue
 * gradient cover, blue section heads, tinted cards). Uses the same WeasyPrint
 * pipeline as the main report renderer.
 */
const fs = require('fs').promises;
const path = require('path');
const Handlebars = require('handlebars');

const OUT_DIR = process.env.REPORT_DIR || path.join(__dirname, '../../storage/reports');
const FONT_DIR = process.env.FONT_DIR || path.join(process.env.HOME || '/home/claude', '.fonts');

function clsFor(label) { return label === 'positive' ? 'pos' : label === 'negative' ? 'neg' : 'neu'; }

// Build the view model from a /results-shaped payload.
function buildVm(data, opts = {}) {
  const good = data.good || [];
  const improve = data.improve || [];
  const deptSummaries = data.departmentSummaries || [];
  const branchSummaries = data.branchSummaries || [];
  const byDepartment = (data.byDepartment || []).map((d) => {
    const ds = deptSummaries.find((x) => (x.name || '').toLowerCase() === (d.key || '').toLowerCase());
    return { ...d, summary: ds ? ds.summary : '' };
  });

  const allPeople = (data.responses || [])
    .filter((r) => r.sentiment && r.sentiment.label)
    .map((r) => ({
      name: r.employeeName || 'Employee',
      department: r.department || 'Unassigned',
      branch: r.branch || 'Unspecified',
      avgScoreNum: r.avgScore != null ? r.avgScore : null,
      avgScore: r.avgScore != null ? r.avgScore.toFixed(1) : '—',
      sentiment: r.sentiment.label,
      cls: clsFor(r.sentiment.label),
      summary: (r.sentiment.summary || r.sentiment.note || '').trim() || 'No detailed read available.',
      recommendation: (r.sentiment.recommendation || '').trim(),
    }));

  // Group employees by branch → team, with per-branch/team sentiment stats.
  const pct = (n, total) => total ? Math.round((n / total) * 100) : 0;
  const statsFor = (list) => {
    const p = list.filter((x) => x.sentiment === 'positive').length;
    const nu = list.filter((x) => x.sentiment === 'neutral').length;
    const ng = list.filter((x) => x.sentiment === 'negative').length;
    const scored = list.filter((x) => x.avgScoreNum != null);
    const avg = scored.length ? (scored.reduce((a, x) => a + x.avgScoreNum, 0) / scored.length) : null;
    return { count: list.length, positive: pct(p, list.length), neutral: pct(nu, list.length), negative: pct(ng, list.length), avgScore: avg != null ? avg.toFixed(1) : '—' };
  };
  const branchMap = {};
  allPeople.forEach((pn) => { (branchMap[pn.branch] = branchMap[pn.branch] || []).push(pn); });
  const branches = Object.keys(branchMap).sort().map((bname) => {
    const list = branchMap[bname];
    const teamMap = {};
    list.forEach((pn) => { (teamMap[pn.department] = teamMap[pn.department] || []).push(pn); });
    const teams = Object.keys(teamMap).sort().map((tname) => ({ name: tname, ...statsFor(teamMap[tname]), people: teamMap[tname] }));
    const bs = branchSummaries.find((x) => (x.name || '').toLowerCase() === bname.toLowerCase());
    return { name: bname, ...statsFor(list), summary: bs ? bs.summary : '', teams };
  });

  const completionPct = data.participants ? Math.round((data.total / data.participants) * 100) : 0;
  const insights = data.insights || { attention: [], oneToOne: [], forHR: [], forManager: [], forManagement: [] };
  // Normalise action items to {action, why, how} in case older data stored strings.
  const normAct = (arr) => (arr || []).map((x) => typeof x === 'string' ? { action: x, why: '', how: '' } : x);
  const hasAttention = !!(insights.attention && insights.attention.length);
  const hasOneToOne = !!(insights.oneToOne && insights.oneToOne.length);
  // If sections 4 (attention) and 5 (1:1) both have data, push section 6 (action
  // plan) onto its own page. If both are empty, 4/5/6 sit together on one page.
  const sixSeparate = hasAttention || hasOneToOne;
  return {
    forWeb: !!opts.forWeb,
    fontDir: 'file://' + FONT_DIR,
    survey: data.survey || { name: 'Survey' },
    period: data.period || '',
    total: data.total || 0,
    participants: data.participants || data.total || 0,
    completionPct,
    generatedAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    sentiment: data.sentiment || { positive: 0, neutral: 0, negative: 0 },
    summary: data.summary || '',
    good, improve, hasThemes: !!(good.length || improve.length),
    byDepartment,
    branches,
    hasBranches: branches.length > 0,
    multiBranch: branches.length > 1,
    sixSeparate,
    insights: {
      attention: insights.attention || [], oneToOne: insights.oneToOne || [],
      forHR: normAct(insights.forHR), forManager: normAct(insights.forManager), forManagement: normAct(insights.forManagement),
    },
    people: allPeople,
  };
}

async function renderHtml(data, opts = {}) {
  const tplSrc = await fs.readFile(path.join(__dirname, '../templates/surveyReport.hbs'), 'utf8');
  const tpl = Handlebars.compile(tplSrc);
  return tpl(buildVm(data, opts));
}

async function renderSurveyReport(data) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const slug = `survey-${data.survey.id || 's'}-${String(data.period || 'p').replace(/[^a-z0-9]/gi, '-')}`;
  const pdfHtmlPath = path.join(OUT_DIR, `${slug}.pdf.html`);
  const pdfPath = path.join(OUT_DIR, `${slug}.pdf`);
  const html = await renderHtml(data, { forWeb: false });
  await fs.writeFile(pdfHtmlPath, html, 'utf8');
  await new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    execFile('python3', ['-m', 'weasyprint', '-e', 'utf-8', '-u', path.dirname(pdfHtmlPath), pdfHtmlPath, pdfPath],
      { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`WeasyPrint failed: ${stderr || err.message}`));
        resolve();
      });
  });
  return { pdfPath, slug };
}

module.exports = { renderSurveyReport, renderHtml, buildVm };
