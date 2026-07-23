/**
 * DEMO / TRAINING DATA
 * --------------------
 * Fabricated records used by the shareable demo link (/demo-app/<token>).
 *
 * Nothing here touches the database. Every object is generated in memory on
 * request, so an agent poking around the demo can never read, edit or delete a
 * real client. The demo API layer serves these objects and swallows writes.
 *
 * The data is deterministic: the same seed always produces the same names and
 * numbers, so a trainer walking a room through the product sees the same thing
 * on every screen, and screenshots stay valid.
 *
 * Deliberately obvious fakes — "Demo" surnames, example.com domains — so no one
 * mistakes a training figure for a real one.
 */

// --- tiny seeded RNG (mulberry32), so output is stable across restarts ------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Aarav', 'Priya', 'Rohan', 'Sneha', 'Vikram', 'Ananya', 'Karan', 'Meera',
  'Arjun', 'Divya', 'Rahul', 'Ishita', 'Nikhil', 'Pooja', 'Sanjay', 'Tara',
  'James', 'Emily', 'Michael', 'Sarah', 'David', 'Laura', 'Chris', 'Hannah'];
const LAST = ['Demo', 'Sample', 'Example', 'Trial', 'Preview', 'Mock', 'Test'];
const COMPANIES = ['Brightpath Dental', 'Verde Landscaping', 'Nova Fitness Studio',
  'Harbour Legal', 'Craft Coffee Roasters', 'Summit Roofing', 'Bluewave Travel',
  'Lumen Interiors', 'Pinecrest Vets', 'Urban Threads Boutique', 'Ironside Gym',
  'Clearview Optics', 'Willow Bakery', 'Redstone Realty', 'Kinetic Physio',
  'Golden Fork Catering', 'Skyline Auto Care', 'Petal & Stem Florists'];
const CITIES = [['New York', 'United States'], ['London', 'United Kingdom'], ['Sydney', 'Australia'],
  ['Toronto', 'Canada'], ['Dublin', 'Ireland'], ['Manchester', 'United Kingdom'],
  ['Chicago', 'United States'], ['Melbourne', 'Australia']];
const SERVICES = ['Complete Digital Marketing', 'Website Design', 'Social Media Promotion',
  'Google Ads Campaign', 'Web Development', 'Logo Design', 'Website Maintenance'];
const SOURCES = ['Pre-Sales', 'Cold Calling', 'Ads & Marketing', 'Referral', 'Inbound'];
const STATUSES = ['new', 'hot', 'contacted', 'interested', 'proposal', 'negotiation'];

// Synthetic staff. Roles mirror the real hierarchy so the org chart, targets and
// leaderboards all have something sensible to render.
const AGENTS = [
  { id: 9001, name: 'Priya Demo', role: 'agent', team: 'Bhubaneswar', shift: 'Morning' },
  { id: 9002, name: 'Rohan Demo', role: 'agent', team: 'Bhubaneswar', shift: 'Morning' },
  { id: 9003, name: 'Sneha Demo', role: 'agent', team: 'Kolkata', shift: 'Night' },
  { id: 9004, name: 'Vikram Demo', role: 'agent', team: 'Kolkata', shift: 'Night' },
  { id: 9005, name: 'Ananya Demo', role: 'agent', team: 'Bhubaneswar', shift: 'Night' },
  { id: 9010, name: 'Karan Demo', role: 'manager', team: 'Bhubaneswar', shift: 'Morning' },
  { id: 9011, name: 'Meera Demo', role: 'manager', team: 'Kolkata', shift: 'Night' },
];

const iso = (d) => new Date(d).toISOString();
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

/**
 * Build one fabricated lead. `converted` forces a won deal with a part-paid
 * installment plan, which is what makes the Converted page worth demoing.
 */
function makeLead(i, r, { converted = false } = {}) {
  const first = pick(r, FIRST);
  const last = pick(r, LAST);
  const company = COMPANIES[i % COMPANIES.length];
  const [city, country] = CITIES[i % CITIES.length];
  const owner = AGENTS[i % 5]; // spread across the five agents
  const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
  const created = daysAgo(90 - (i % 80));

  const lead = {
    _id: `demo_lead_${i}`,
    id: `demo_lead_${i}`,
    ownerId: owner.id,
    ownerName: owner.name,
    ownerTeam: owner.team,
    ownerShift: owner.shift,
    firstName: first,
    lastName: `${last} (${company})`,
    website: `https://www.${slug}.example.com`,
    domain: `${slug}.example.com`,
    email: `${first.toLowerCase()}@${slug}.example.com`,
    secondaryEmail: '',
    mobile: '+1 555 0100',
    phone: '+1 555 0101',
    leadSource: pick(r, SOURCES),
    generatedBy: owner.name,
    status: converted ? 'converted' : pick(r, STATUSES),
    servicesInterested: [pick(r, SERVICES)],
    tags: [],
    country,
    city,
    timezone: '',
    additionalInfo: 'Demo record — not a real client.',
    notes: [
      { id: `n_${i}_1`, text: 'Intro call went well. Sent the audit report over.', author: owner.name, time: iso(daysAgo(20)) },
    ],
    activities: [],
    deals: [],
    timeline: [],
    createdAt: iso(created),
    updatedAt: iso(daysAgo(3)),
    lastActivityAt: iso(daysAgo(3)),
    convertedAt: converted ? iso(daysAgo(15 + (i % 30))) : null,
  };

  if (converted) {
    // A three-part payment plan with the first installment collected — exactly
    // the shape that exercises the Outstanding column and the "+" expander.
    const total = 1200 + (i % 6) * 400;
    const part = Math.round(total / 3);
    const wonAt = daysAgo(15 + (i % 30));
    const paidSecond = i % 3 === 0; // some clients are further along than others
    lead.deals = [{
      id: `demo_deal_${i}`,
      name: `${company} — ${pick(r, SERVICES)}`,
      stage: 'closed_won',
      currency: 'USD',
      amount: total,
      service: pick(r, SERVICES),
      expectedClose: ymd(wonAt),
      wonAt: iso(wonAt),
      paymentStructure: 'installments',
      remark: 'Demo deal.',
      installments: [
        { id: `demo_inst_${i}_1`, seq: 1, amount: part, dueDate: ymd(wonAt), paid: true, paidDate: ymd(wonAt) },
        { id: `demo_inst_${i}_2`, seq: 2, amount: part, dueDate: ymd(daysAgo(-10 + (i % 20))), paid: paidSecond, paidDate: paidSecond ? ymd(daysAgo(5)) : null },
        { id: `demo_inst_${i}_3`, seq: 3, amount: total - part * 2, dueDate: ymd(daysAgo(-40 + (i % 20))), paid: false, paidDate: null },
      ],
    }];
    lead.timeline = [
      { type: 'status', text: 'Converted to client (payment received)', time: iso(wonAt), author: owner.name },
      { type: 'deal', text: 'Installment 1 marked paid', time: iso(wonAt), author: owner.name },
    ];
  }
  return lead;
}

/**
 * The full fabricated lead book: a mix of active pipeline and won clients.
 *
 * Built once and cached. The generator draws from a seeded RNG, so it must be
 * created and consumed exactly once — regenerating per request would advance
 * the sequence and shuffle names between screens, which is disorienting mid
 * training session. Callers get a deep copy so a mutation in one request can
 * never leak into the next.
 */
let _leads = null;
function leads() {
  if (!_leads) {
    const r = rng(20260723);
    const out = [];
    for (let i = 0; i < 18; i++) out.push(makeLead(i, r, { converted: false }));
    for (let i = 18; i < 30; i++) out.push(makeLead(i, r, { converted: true }));
    _leads = out;
  }
  return JSON.parse(JSON.stringify(_leads));
}

/** Fabricated audit reports for the Reports list. Cached, as with leads(). */
let _reports = null;
function reports() {
  if (_reports) return JSON.parse(JSON.stringify(_reports));
  const r = rng(77001);
  _reports = COMPANIES.slice(0, 12).map((company, i) => {
    const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
    const owner = AGENTS[i % 5];
    const overall = 35 + ((i * 7) % 55);
    return {
      _id: `demo_report_${i}`,
      id: `demo_report_${i}`,
      businessName: company,
      customerName: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      domain: `${slug}.example.com`,
      status: i % 9 === 8 ? 'failed' : 'complete',
      services: [pick(r, ['SEO', 'SMO', 'AI SEO', 'GEO', 'Local SEO'])],
      agentName: owner.name,
      agentId: owner.id,
      scores: { overall, seo: overall + 4, performance: overall - 6, content: overall + 2 },
      createdAt: iso(daysAgo(2 + i * 3)),
      leadId: i % 4 === 0 ? `demo_lead_${18 + (i % 12)}` : null,
      demo: true,
    };
  });
  return JSON.parse(JSON.stringify(_reports));
}

/** Staff list for admin/org/analytics screens. */
function users() {
  return AGENTS.map((a) => ({
    _id: `demo_user_${a.id}`, id: a.id, name: a.name, role: a.role,
    email: `${a.name.split(' ')[0].toLowerCase()}@demo.example.com`,
    team: a.team, shift: a.shift, active: true, targetUsd: a.role === 'manager' ? 12000 : 6000,
    createdAt: iso(daysAgo(300)),
  }));
}

module.exports = { leads, reports, users, AGENTS };
