const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { Report, User, Settings, AuditLog, Op } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { normaliseUrl } = require('../services/crawler');
const { enqueueReport } = require('../queue');

const SERVICES = ['SEO', 'SMO', 'AI SEO', 'GEO', 'AEO', 'Local SEO'];

const createSchema = z.object({
  website: z.string().min(4, 'Enter the website address.'),
  businessName: z.string().min(1, 'Enter the business name.'),
  customerName: z.string().min(1, 'Enter the customer name.'),
  services: z.array(z.enum(SERVICES)).min(1, 'Select at least one service.'),
  country: z.string().length(2).optional(),
  location: z.string().optional(),
});

/** POST /api/reports — queue a new audit. */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const input = parsed.data;

    // Validate the URL before we spend a single credit on it.
    let domain;
    try {
      domain = normaliseUrl(input.website).hostname.replace(/^www\./, '');
    } catch {
      return res.status(400).json({ error: 'That website address is not valid.' });
    }

    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!settings) return res.status(500).json({ error: 'Settings are not configured yet.' });
    if (!settings.getKey('seranking') || !settings.getKey('anthropic')) {
      return res.status(400).json({
        error: 'API keys are not configured. Ask an admin to add them in Admin → Settings.',
      });
    }

    // Daily cap per agent. "Free" plus no limit equals a runaway credit bill.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await Report.count({ where: { agentId: req.user.id, createdAt: { [Op.gte]: since } } });
    if (todayCount >= settings.dailyReportLimit) {
      return res.status(429).json({
        error: `You've reached your limit of ${settings.dailyReportLimit} reports for today.`,
      });
    }

    // 7-day cache: re-running the same domain costs credits and returns the
    // same numbers. Hand back the existing report instead.
    const cacheCutoff = new Date(Date.now() - settings.cacheDays * 24 * 60 * 60 * 1000);
    const cached = await Report.findOne({
      where: { domain, status: 'complete', createdAt: { [Op.gte]: cacheCutoff } },
      order: [['createdAt', 'DESC']],
    });

    if (cached && !req.body.force) {
      return res.json({
        cached: true,
        reportId: cached.id,
        message: `We ran ${domain} on ${cached.createdAt.toLocaleDateString('en-GB')}. Open that report, or choose "Run fresh" to spend credits on a new one.`,
      });
    }

    const report = await Report.create({
      agentId: req.user.id,
      agentName: req.user.name,
      agentPhone: req.user.phone,
      agentEmail: req.user.email,
      agentDesignation: req.user.designation,
      website: input.website,
      domain,
      businessName: input.businessName,
      customerName: input.customerName,
      services: input.services,
      country: input.country || settings.defaultCountry,
      location: input.location,
      status: 'queued',
    });

    await User.increment('reportsRun', { where: { id: req.user.id } });
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'report.create',
      target: domain, meta: { services: input.services }, ip: req.ip,
    });

    await enqueueReport(report.id);
    res.status(201).json({ reportId: report.id, status: 'queued' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/reports — agents see their own; admins see everything. */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, q, page = 1, limit = 20 } = req.query;
    const where = req.user.role === 'admin' ? {} : { agentId: req.user.id };
    if (status) where.status = status;
    if (req.query.stage) where.stage = req.query.stage;
    if (q) {
      where[Op.or] = [
        { businessName: { [Op.like]: `%${q}%` } },
        { domain: { [Op.like]: `%${q}%` } },
        { customerName: { [Op.like]: `%${q}%` } },
        // Admins search by agent name too (powers the dashboard "click an agent"
        // drill-down). Harmless for agents, who are already scoped to their own.
        { agentName: { [Op.like]: `%${q}%` } },
      ];
    }
    const { rows: items, count: total } = await Report.findAndCountAll({
      where,
      // `data` is 100-300KB per row. Never select it for a list.
      attributes: { exclude: ['data'] },
      order: [['createdAt', 'DESC']],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
      include: [{ model: User, as: 'agent', attributes: ['name', 'email'] }],
    });
    res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    next(e);
  }
});

/** GET /api/reports/:id — single report. */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id, {
      include: [{ model: User, as: 'agent', attributes: ['name', 'email'] }],
    });
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (req.user.role !== 'admin' && report.agentId !== req.user.id) {
      return res.status(403).json({ error: 'This report belongs to another agent.' });
    }
    res.json(report);
  } catch (e) {
    next(e);
  }
});

/** GET /api/reports/:id/status — live progress via SSE. */
router.get('/:id/status', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });

  const poll = async () => {
    if (closed) return;
    const r = await Report.findByPk(req.params.id, { attributes: ['status', 'progress', 'currentStep', 'error'] });
    if (!r) {
      res.write(`data: ${JSON.stringify({ error: 'Report not found' })}\n\n`);
      return res.end();
    }
    res.write(`data: ${JSON.stringify({
      status: r.status, progress: r.progress, step: r.currentStep, error: r.error,
    })}\n\n`);

    if (['complete', 'failed'].includes(r.status)) return res.end();
    setTimeout(poll, 2000);
  };
  poll();
});

/** GET /api/reports/:id/download — the PDF. Regenerates from stored data if missing. */
router.get('/:id/download', requireAuth, async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (req.user.role !== 'admin' && report.agentId !== req.user.id) {
      return res.status(403).json({ error: 'This report belongs to another agent.' });
    }
    // Self-heal: if the rendered PDF is gone (container restart wipes the disk)
    // but the report data is in the database, re-render it on the fly. This is
    // why everything is stored in MySQL — the files are disposable, the data is not.
    if (!report.pdfPath || !fs.existsSync(report.pdfPath)) {
      if (report.status === 'complete' && report.data && Object.keys(report.data).length) {
        try {
          const { renderReport } = require('../services/renderer');
          const out = await renderReport(report.data);
          report.pdfPath = out.pdfPath;
          report.htmlPath = out.htmlPath;
          await report.save();
        } catch (e) {
          return res.status(503).json({ error: `Could not regenerate the PDF: ${e.message}` });
        }
      } else {
        return res.status(404).json({ error: 'The PDF is not ready yet.' });
      }
    }
    const safe = `${report.businessName.replace(/[^a-z0-9]/gi, '-')}-Site-Analysis.pdf`;
    res.download(report.pdfPath, safe);
  } catch (e) {
    next(e);
  }
});

/** GET /api/reports/:id/view — HTML version. Regenerates from stored data if missing. */
router.get('/:id/view', requireAuth, async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id);
    if (!report) return res.status(404).send('Report not found.');
    if (req.user.role !== 'admin' && report.agentId !== req.user.id) {
      return res.status(403).send('This report belongs to another agent.');
    }
    if (!report.htmlPath || !fs.existsSync(report.htmlPath)) {
      if (report.status === 'complete' && report.data && Object.keys(report.data).length) {
        try {
          const { renderReport } = require('../services/renderer');
          const out = await renderReport(report.data);
          report.pdfPath = out.pdfPath;
          report.htmlPath = out.htmlPath;
          await report.save();
        } catch (e) {
          return res.status(503).send(`Could not regenerate the report: ${e.message}`);
        }
      } else {
        return res.status(404).send('Report not available yet.');
      }
    }
    res.sendFile(path.resolve(report.htmlPath));
  } catch (e) {
    next(e);
  }
});

const STAGES = ['new', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost'];

/**
 * PATCH /api/reports/:id — update the CRM fields only.
 * Deliberately narrow: an agent must never be able to rewrite the report's
 * findings, only their own notes about the prospect.
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (req.user.role !== 'admin' && report.agentId !== req.user.id) {
      return res.status(403).json({ error: 'This report belongs to another agent.' });
    }

    const { stage, tags, remark, followUpAt } = req.body || {};
    if (stage !== undefined) {
      if (!STAGES.includes(stage)) return res.status(400).json({ error: 'That is not a valid pipeline stage.' });
      report.stage = stage;
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'Tags must be a list.' });
      report.tags = tags.slice(0, 20).map((t) => String(t).slice(0, 60));
      report.changed('tags', true);
    }
    if (remark !== undefined) report.remark = String(remark).slice(0, 5000);
    if (followUpAt !== undefined) report.followUpAt = followUpAt || null;

    await report.save();
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'report.crm',
      target: report.domain, meta: { stage: report.stage }, ip: req.ip,
    });
    res.json({ ok: true, stage: report.stage, tags: report.tags, remark: report.remark, followUpAt: report.followUpAt });
  } catch (e) { next(e); }
});

/** POST /api/reports/:id/retry — re-run a failed report. */
router.post('/:id/retry', requireAuth, async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (req.user.role !== 'admin' && report.agentId !== req.user.id) {
      return res.status(403).json({ error: 'This report belongs to another agent.' });
    }
    if (report.status === 'running') return res.status(400).json({ error: 'This report is already running.' });

    report.status = 'queued';
    report.progress = 0;
    report.error = null;
    await report.save();
    await enqueueReport(report.id);
    res.json({ ok: true, status: 'queued' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
