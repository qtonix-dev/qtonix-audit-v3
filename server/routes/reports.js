const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { Report, User, Lead, Settings, AuditLog, Op } = require('../models');

// Re-render a stored report using the CURRENT pricing and branding, not the
// snapshot taken when it was first generated. Pricing/branding are agency-wide
// settings the admin tweaks over time, and every report (old or new) should
// reflect the latest — so we always merge live settings in before rendering.
async function renderWithLiveSettings(report) {
  const { renderReport } = require('../services/renderer');
  const settings = await Settings.findOne({ where: { singleton: 'settings' } });
  const data = { ...report.data };
  if (settings) {
    data.pricing = settings.pricing ? JSON.parse(JSON.stringify(settings.pricing)) : { enabled: false };
    if (data.settings) {
      data.settings = {
        ...data.settings,
        colors: settings.colors || data.settings.colors,
        logoPath: settings.logoPath || data.settings.logoPath,
        companyName: settings.companyName || data.settings.companyName,
        companyShort: settings.companyShort || data.settings.companyShort,
        website: settings.website || data.settings.website,
        phone: settings.phone || data.settings.phone,
        email: settings.email || data.settings.email,
      };
    }
  }
  const out = await renderReport(data);
  report.pdfPath = out.pdfPath;
  report.htmlPath = out.htmlPath;
  await report.save();
  return out;
}
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
  customerPhone: z.string().optional(),
  customerEmail: z.string().optional(),
  customerCountry: z.string().optional(),
  customerCompany: z.string().optional(),
  leadId: z.union([z.number(), z.string()]).optional().nullable(),
  confirmDuplicate: z.boolean().optional(),
  force: z.boolean().optional(),
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
      customerPhone: input.customerPhone || '',
      customerEmail: input.customerEmail || '',
      customerCountry: input.customerCountry || '',
      customerCompany: input.customerCompany || '',
      status: 'queued',
    });

    // ---- Link this report to a lead -----------------------------------------
    // Three cases:
    //  (a) run from inside a lead detail page -> input.leadId is set: attach.
    //  (b) run standalone, a lead with this domain exists & is the running
    //      agent's -> attach to it.
    //  (c) run standalone, a lead with this domain belongs to ANOTHER agent ->
    //      unless the agent confirmed a duplicate, we still create a new lead
    //      under the running agent but flag ownerConflict so the UI can warn.
    //  (d) no match -> auto-create a new lead under the running agent.
    try {
      let lead = null;
      let ownerConflict = null;

      if (input.leadId) {
        lead = await Lead.findByPk(input.leadId);
        if (lead && (req.user.role === 'admin' || lead.ownerId === req.user.id ||
          (req.user.role === 'manager'))) {
          // attach (visibility already implies access for manager/admin)
        } else {
          lead = null;
        }
      }

      if (!lead && domain) {
        const own = await Lead.findOne({ where: { domain, ownerId: req.user.id } });
        if (own) {
          lead = own;
        } else {
          const others = await Lead.findOne({ where: { domain, ownerId: { [Op.ne]: req.user.id } } });
          if (others && !input.confirmDuplicate) {
            // Report is created, but flag the conflict — the client decides
            // whether to create a duplicate lead (confirmDuplicate on a retry)
            // or leave the report unlinked for now.
            ownerConflict = { existingOwner: others.ownerName, existingLeadId: others.id };
          }
        }
      }

      if (!lead && !ownerConflict) {
        // create a fresh lead under the running agent
        const nameParts = String(input.customerName || input.businessName || 'Unknown').trim().split(/\s+/);
        lead = await Lead.create({
          ownerId: req.user.id,
          ownerName: req.user.name,
          ownerTeam: req.user.team || 'Bhubaneswar',
          ownerShift: req.user.shift || 'Morning',
          firstName: nameParts[0] || 'Unknown',
          lastName: nameParts.slice(1).join(' '),
          website: input.website,
          domain,
          email: input.customerEmail || '',
          mobile: input.customerPhone || '',
          country: input.customerCountry || '',
          servicesInterested: [],
          status: 'new',
          additionalInfo: `Auto-created from a report run for ${input.businessName || domain}.`,
          lastActivityAt: new Date(),
          timeline: [{ type: 'created', text: 'Lead auto-created from a report run', time: new Date().toISOString(), author: req.user.name }],
        });
      }

      if (lead) {
        report.leadId = lead.id;
        await report.save();
        const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
        tl.push({ type: 'report', text: `Report generated for ${input.businessName || domain}`, time: new Date().toISOString(), author: req.user.name });
        lead.timeline = tl; lead.changed('timeline', true);
        lead.lastActivityAt = new Date();
        await lead.save();
      }
      // stash the conflict on the response below
      report._ownerConflict = ownerConflict;
    } catch (linkErr) {
      console.error('[lead-link] skipped:', linkErr.message);
    }

    await User.increment('reportsRun', { where: { id: req.user.id } });
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'report.create',
      target: domain, meta: { services: input.services }, ip: req.ip,
    });

    await enqueueReport(report.id);
    res.status(201).json({ reportId: report.id, status: 'queued', leadId: report.leadId || null, ownerConflict: report._ownerConflict || null });
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
    // Always regenerate with the latest pricing/branding so admin edits show up.
    if (report.status === 'complete' && report.data && Object.keys(report.data).length) {
      try {
        await renderWithLiveSettings(report);
      } catch (e) {
        // Fall back to an existing file if the fresh render fails.
        if (!report.pdfPath || !fs.existsSync(report.pdfPath)) {
          return res.status(503).json({ error: `Could not regenerate the PDF: ${e.message}` });
        }
      }
    } else if (!report.pdfPath || !fs.existsSync(report.pdfPath)) {
      return res.status(404).json({ error: 'The PDF is not ready yet.' });
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
    if (report.status === 'complete' && report.data && Object.keys(report.data).length) {
      try {
        await renderWithLiveSettings(report);
      } catch (e) {
        if (!report.htmlPath || !fs.existsSync(report.htmlPath)) {
          return res.status(503).send(`Could not regenerate the report: ${e.message}`);
        }
      }
    } else if (!report.htmlPath || !fs.existsSync(report.htmlPath)) {
      return res.status(404).send('Report not available yet.');
    }
    res.sendFile(path.resolve(report.htmlPath));
  } catch (e) {
    next(e);
  }
});

const STAGES = ['new', 'hot', 'cold', 'ni', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost'];

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

    const { stage, tags, remark, followUpAt, customerPhone, customerEmail, customerCountry, customerCompany, customerName } = req.body || {};
    const activity = Array.isArray(report.activity) ? report.activity : [];
    const now = new Date().toISOString();

    if (stage !== undefined) {
      if (!STAGES.includes(stage)) return res.status(400).json({ error: 'That is not a valid pipeline stage.' });
      if (stage !== report.stage) {
        const label = { new: 'New lead', hot: 'Hot', cold: 'Cold', ni: 'Not interested', contacted: 'Contacted', interested: 'Interested', proposal: 'Proposal sent', negotiation: 'Negotiating', won: 'Won', lost: 'Lost' }[stage] || stage;
        activity.push({ type: 'stage', text: `Status changed to "${label}"`, time: now, author: req.user.name });
      }
      report.stage = stage;
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'Tags must be a list.' });
      const newTags = tags.slice(0, 20).map((t) => String(t).slice(0, 60));
      const prev = (report.tags || []).join(',');
      if (newTags.join(',') !== prev) {
        activity.push({ type: 'request', text: newTags.length ? `Request set to "${newTags.join(', ')}"` : 'Request cleared', time: now, author: req.user.name });
      }
      report.tags = newTags;
      report.changed('tags', true);
    }
    if (remark !== undefined) report.remark = String(remark).slice(0, 5000);
    if (followUpAt !== undefined) report.followUpAt = followUpAt || null;
    if (customerName !== undefined) report.customerName = String(customerName).slice(0, 190);
    if (customerPhone !== undefined) report.customerPhone = String(customerPhone).slice(0, 40);
    if (customerEmail !== undefined) report.customerEmail = String(customerEmail).slice(0, 180);
    if (customerCountry !== undefined) report.customerCountry = String(customerCountry).slice(0, 60);
    if (customerCompany !== undefined) report.customerCompany = String(customerCompany).slice(0, 190);

    report.activity = activity;
    report.changed('activity', true);
    await report.save();
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'report.crm',
      target: report.domain, meta: { stage: report.stage }, ip: req.ip,
    });
    res.json(report);
  } catch (e) { next(e); }
});

/** POST /api/reports/:id/remark — append a timestamped remark (never overwrites). */
router.post('/:id/remark', requireAuth, async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (req.user.role !== 'admin' && report.agentId !== req.user.id) {
      return res.status(403).json({ error: 'This report belongs to another agent.' });
    }
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: 'Remark text is required.' });

    const list = Array.isArray(report.remarks) ? report.remarks : [];
    const entry = { text: text.slice(0, 5000), time: new Date().toISOString(), author: req.user.name };
    list.push(entry);
    report.remarks = list;
    report.changed('remarks', true);

    // Mirror into the unified activity timeline.
    const activity = Array.isArray(report.activity) ? report.activity : [];
    activity.push({ type: 'remark', text: entry.text, time: entry.time, author: entry.author });
    report.activity = activity;
    report.changed('activity', true);
    await report.save();
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'report.remark',
      target: report.domain, ip: req.ip,
    });
    res.json(report);
  } catch (e) { next(e); }
});
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
