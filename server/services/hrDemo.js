/**
 * HRMS DEMO — a self-contained, editable demo populated with fabricated data,
 * fully isolated from live data (all demo employees carry isDemo=true, and their
 * related rows link to those demo user ids). Admin toggles it on to get three
 * no-login role URLs (admin / manager / employee). A reset wipes & reseeds the
 * demo employees so it always looks fresh.
 *
 * URLs:  /hr-demo/<token>/admin   /hr-demo/<token>/manager   /hr-demo/<token>/employee
 * The frontend detects the path, calls /api/hr/demo/session to get a real HR JWT
 * for the matching seeded demo user, then behaves exactly like the live app.
 */
const bcrypt = require('bcryptjs');
const { Op, Settings, HrUser, HrBranch, HrDepartment, HrAttendance, Task } = require('../models');

const DEMO_EMAIL_DOMAIN = 'demo.qtonix.local';
const isDemoEmail = (e) => String(e || '').endsWith('@' + DEMO_EMAIL_DOMAIN);

function istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(Date.now() + 330 * 60000 - n * 86400000).toISOString().slice(0, 10); }

// The seeded cast — one admin/HR, a couple of managers (dept heads), and staff.
const SEED = [
  { key: 'admin', name: 'Demo Admin (HR)', designation: 'HR Manager', department: 'Human Resources', type: 'hr', role: 'admin' },
  { key: 'manager_seo', name: 'Riya Sharma', designation: 'SEO Team Lead', department: 'SEO', type: 'manager', role: 'manager' },
  { key: 'manager_dev', name: 'Arjun Mehta', designation: 'Development Lead', department: 'Development', type: 'manager', role: 'manager' },
  { key: 'employee', name: 'Priya Nair', designation: 'SEO Executive', department: 'SEO', type: 'junior', role: 'employee' },
  { name: 'Karan Gupta', designation: 'Content Writer', department: 'Content', type: 'junior' },
  { name: 'Sneha Rao', designation: 'Social Media Executive', department: 'Social Media', type: 'junior' },
  { name: 'Vikram Singh', designation: 'Frontend Developer', department: 'Development', type: 'junior' },
  { name: 'Ananya Das', designation: 'Backend Developer', department: 'Development', type: 'junior' },
  { name: 'Rahul Verma', designation: 'PPC Specialist', department: 'Performance Marketing', type: 'junior' },
  { name: 'Meera Iyer', designation: 'Designer', department: 'Design', type: 'junior' },
];

async function wipeDemo() {
  const demoUsers = await HrUser.findAll({ where: { isDemo: true }, attributes: ['id'] });
  const ids = demoUsers.map((u) => u.id);
  if (ids.length) {
    await Task.destroy({ where: { [Op.or]: [{ boardOwnerId: { [Op.in]: ids } }, { assigneeId: { [Op.in]: ids } }] } }).catch(() => {});
    await HrAttendance.destroy({ where: { employeeId: { [Op.in]: ids } } }).catch(() => {});
  }
  await HrUser.destroy({ where: { isDemo: true } });
}

// Seed (or reseed) the demo. Idempotent: wipes existing demo rows first.
async function seedDemo() {
  await wipeDemo();
  const pw = await bcrypt.hash('demo', 10);
  const branch = 'Bhubaneswar';
  // Ensure a demo branch/department exist for realism (non-demo-scoped, harmless).
  const created = {};
  let idx = 0;
  const managerByDept = {};
  for (const s of SEED) {
    const email = `${(s.key || s.name.toLowerCase().replace(/[^a-z]+/g, '.'))}@${DEMO_EMAIL_DOMAIN}`;
    const u = await HrUser.create({
      isDemo: true, name: s.name, email, passwordHash: pw, phone: '+91 90000 000' + (idx++),
      designation: s.designation, department: s.department, type: s.type, branch, active: true,
      joiningDate: daysAgo(120 + idx * 15), birthday: `1995-${String((idx % 12) + 1).padStart(2, '0')}-15`,
      isHrManager: s.role === 'admin', hrManagerScope: s.role === 'admin' ? 'all' : '',
    });
    if (s.key) created[s.key] = u;
    if (s.type === 'manager') managerByDept[s.department] = u;
  }
  // Wire reporting lines: staff → their dept manager (or SEO lead as fallback).
  const staff = await HrUser.findAll({ where: { isDemo: true, type: 'junior' } });
  for (const st of staff) {
    const mgr = managerByDept[st.department] || created.manager_seo;
    if (mgr) { st.reportsToId = mgr.id; await st.save(); }
  }
  // Attendance for the last 10 working days + a few tasks per person.
  const all = await HrUser.findAll({ where: { isDemo: true } });
  for (const u of all) {
    for (let d = 0; d < 10; d++) {
      const date = daysAgo(d);
      const dow = new Date(date + 'T00:00:00').getDay();
      if (dow === 0) continue; // skip Sundays
      const present = Math.random() > 0.08;
      await HrAttendance.create({ employeeId: u.id, date, status: present ? 'present' : 'absent', loginTime: present ? '09:5' + (d % 9) : null, logoutTime: present ? '18:3' + (d % 6) : null, late: present && Math.random() > 0.8 });
    }
    // A few tasks in varied statuses.
    const stages = ['not_started', 'in_progress', 'pending_review', 'completed', 'completed'];
    const titles = ['Keyword research', 'Write blog article', 'Fix homepage bug', 'Monthly report', 'Client call follow-up', 'Backlink outreach', 'Design social post'];
    for (let i = 0; i < 4; i++) {
      const title = titles[(u.id + i) % titles.length];
      await Task.create({ boardOwnerId: u.id, assigneeId: u.id, assigneeIds: [u.id], title, stage: stages[(u.id + i) % stages.length], priority: ['high', 'medium', 'low'][i % 3], bucket: ['today', 'tomorrow', 'later'][i % 3], dueDate: daysAgo(-(i + 1)) });
    }
  }
  return { count: all.length };
}

// Resolve the seeded demo user for a role.
async function demoUserForRole(role) {
  const key = role === 'admin' ? 'admin' : role === 'manager' ? 'manager_seo' : 'employee';
  const email = `${key}@${DEMO_EMAIL_DOMAIN}`;
  let u = await HrUser.findOne({ where: { email, isDemo: true } });
  if (!u) { await seedDemo(); u = await HrUser.findOne({ where: { email, isDemo: true } }); }
  return u;
}

module.exports = { seedDemo, wipeDemo, demoUserForRole, isDemoEmail, DEMO_EMAIL_DOMAIN };
