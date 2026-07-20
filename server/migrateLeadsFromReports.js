// One-time (idempotent) migration: turn each existing Report into a Lead and
// link the report back to it. Safe to run on every boot — it skips reports that
// already have a linked lead (tracked via Lead.sourceReportId) and links reports
// to their lead. New reports going forward are linked at creation time.
const { Lead, Report, User } = require('./models');

function toDomain(website) {
  if (!website) return '';
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(website).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

async function migrateLeadsFromReports() {
  // Only migrate real reports (not demo), and only those not already linked.
  const reports = await Report.findAll({ where: {} });
  let created = 0;
  let linked = 0;
  for (const r of reports) {
    if (r.isDemo) continue;
    if (r.leadId) continue; // already linked

    // Has a lead already been created from this report?
    let lead = await Lead.findOne({ where: { sourceReportId: r.id } });

    if (!lead) {
      // Try to match an existing lead by domain + same owner, to avoid dupes.
      const domain = r.domain || toDomain(r.website);
      if (domain) {
        lead = await Lead.findOne({ where: { domain, ownerId: r.agentId } });
      }
    }

    if (!lead) {
      const owner = await User.findByPk(r.agentId);
      const nameParts = String(r.customerName || r.businessName || 'Unknown').trim().split(/\s+/);
      lead = await Lead.create({
        ownerId: r.agentId,
        ownerName: r.agentName || (owner && owner.name) || '',
        ownerTeam: (owner && owner.team) || 'Bhubaneswar',
        ownerShift: (owner && owner.shift) || 'Morning',
        firstName: nameParts[0] || 'Unknown',
        lastName: nameParts.slice(1).join(' '),
        website: r.website || '',
        domain: r.domain || toDomain(r.website),
        email: r.customerEmail || '',
        mobile: r.customerPhone || '',
        leadSource: '',
        status: r.stage || 'new',
        servicesInterested: [],
        tags: Array.isArray(r.tags) ? r.tags : [],
        country: r.customerCountry || '',
        additionalInfo: `Migrated from report for ${r.businessName || r.domain}.`,
        sourceReportId: r.id,
        lastActivityAt: r.createdAt || new Date(),
        timeline: [{ type: 'created', text: 'Lead migrated from existing report', time: new Date().toISOString(), author: r.agentName || 'system' }],
      });
      created++;
    }

    // Link the report to the lead.
    r.leadId = lead.id;
    await r.save();
    linked++;
  }
  if (created || linked) console.log(`[migrate] leads created: ${created}, reports linked: ${linked}`);
  return { created, linked };
}

module.exports = { migrateLeadsFromReports };
