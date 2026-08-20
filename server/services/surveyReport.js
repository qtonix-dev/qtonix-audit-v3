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
  const byDepartment = (data.byDepartment || []).map((d) => {
    const ds = deptSummaries.find((x) => (x.name || '').toLowerCase() === (d.key || '').toLowerCase());
    return { ...d, summary: ds ? ds.summary : '' };
  });
  const people = (data.responses || [])
    .filter((r) => r.sentiment && r.sentiment.label)
    .map((r) => ({
      name: r.employeeName || 'Employee',
      department: r.department || '—',
      avgScore: r.avgScore != null ? r.avgScore.toFixed(1) : '—',
      sentiment: r.sentiment.label,
      cls: clsFor(r.sentiment.label),
      summary: (r.sentiment.summary || r.sentiment.note || '').trim() || 'No detailed read available.',
    }));
  const completionPct = data.participants ? Math.round((data.total / data.participants) * 100) : 0;
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
    insights: data.insights || { attention: [], oneToOne: [], forHR: [], forManager: [], forManagement: [] },
    people,
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
