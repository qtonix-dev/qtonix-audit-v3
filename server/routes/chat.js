/**
 * Company Chat (Workspace) — Phase 1: direct messages + file sharing.
 * Built on HrUser accounts. Real-time via short-polling (GET /poll).
 */
const express = require('express');
const router = express.Router();
const { Op, HrUser, User, ChatConversation, ChatMembership, ChatMessage, ChatTeam, ChatTeamMember } = require('../models');
const { requireHrAccess } = require('../middleware/hrAuth');

// ===== Phase 3: in-memory presence + typing (no DB writes on heartbeat) =====
// presence: userId -> last-seen epoch ms. Considered online if seen < 40s ago.
const presence = new Map();
// typing: conversationId -> Map(userId -> expiresAt). Auto-expires after ~6s.
const typingByConv = new Map();
const ONLINE_MS = 40000;
function markSeen(uid) { if (uid) presence.set(uid, Date.now()); }
function isOnline(uid) { const t = presence.get(uid); return !!t && (Date.now() - t) < ONLINE_MS; }
function setTyping(convId, uid) { let m = typingByConv.get(convId); if (!m) { m = new Map(); typingByConv.set(convId, m); } m.set(uid, Date.now() + 6000); }
function typingUsers(convId, exceptUid) { const m = typingByConv.get(convId); if (!m) return []; const now = Date.now(); const out = []; for (const [uid, exp] of m) { if (exp < now) m.delete(uid); else if (uid !== exceptUid) out.push(uid); } return out; }

// The chat identity is the logged-in HR user.
// The chat identity is an HrUser id. HR employees have req.hrUser directly.
// A CRM admin has req.adminUser (a separate User row) — we resolve them to
// their matching HrUser by email so they chat as their real profile. Cached on
// req to avoid repeat lookups.
async function resolveMe(req) {
  if (req._chatMeId !== undefined) return req._chatMeId;
  let id = null, name = null;
  if (req.hrUser) { id = req.hrUser.id; name = req.hrUser.name; }
  else if (req.adminUser) {
    // Match the admin to an HR profile by email. If none exists, auto-provision
    // one so the admin is a real, messageable chat participant (others can DM
    // them and add them to groups). Uses the admin's User details.
    let hr = await HrUser.findOne({ where: { email: req.adminUser.email } });
    if (!hr) {
      try {
        hr = await HrUser.create({
          name: req.adminUser.name || 'Admin',
          email: req.adminUser.email,
          passwordHash: req.adminUser.passwordHash || require('crypto').randomBytes(24).toString('hex'),
          type: 'manager',
          designation: req.adminUser.designation || 'Admin',
          active: true, chatOnly: true,
        });
      } catch (e) {
        // Race or unique conflict → re-fetch.
        hr = await HrUser.findOne({ where: { email: req.adminUser.email } });
      }
    }
    if (hr) { id = hr.id; name = hr.name; }
  }
  req._chatMeId = id; req._chatMeName = name || (req.adminUser && req.adminUser.name) || 'User';
  // Chat-manage privilege: CRM admin, HR manager, or HR-department staff.
  let canManage = !!(req.isHrAdmin || req.isHrManager || (req.hrUser && ['hr', 'recruiter'].includes(req.hrUser.type)));
  if (!canManage && req.hrUser) { try { const adminAcct = await User.findOne({ where: { email: req.hrUser.email, role: 'admin', active: true } }); if (adminAcct) canManage = true; } catch {} }
  req._chatCanManage = canManage;
  return id;
}
function meId(req) { return req._chatMeId != null ? req._chatMeId : (req.hrUser ? req.hrUser.id : null); }
function meName(req) { return req._chatMeName || (req.hrUser && req.hrUser.name) || 'User'; }
function dmKeyFor(a, b) { const [x, y] = [Number(a), Number(b)].sort((m, n) => m - n); return `${x}-${y}`; }

// Small helper: shape a user for the client (id, name, avatar, role bits).
function pubUser(u) { return u ? { id: u.id, name: u.name, avatar: u.avatar || '', department: u.department || '', designation: u.designation || '' } : null; }

// Router-wide: require HR access, then resolve the caller's HrUser id (works for
// HR staff and CRM admins). Runs before every chat handler.
router.use(requireHrAccess, async (req, res, next) => { try { await resolveMe(req); next(); } catch (e) { next(e); } });

// ---- Directory: everyone you can message (all active users minus yourself) --
router.get('/directory', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const users = await HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'avatar', 'department', 'designation'], order: [['name', 'ASC']] });
    res.json({ users: users.filter((u) => u.id !== me).map(pubUser) });
  } catch (e) { next(e); }
});

// ---- List my conversations (DMs) with the other person + unread count -------
router.get('/conversations', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    if (!me) return res.json({ conversations: [] });
    const mems = await ChatMembership.findAll({ where: { userId: me, hidden: false } });
    const convIds = mems.map((m) => m.conversationId);
    if (!convIds.length) return res.json({ conversations: [] });
    const convs = await ChatConversation.findAll({ where: { id: { [Op.in]: convIds } }, order: [['lastMessageAt', 'DESC']] });
    // Resolve the "other" member for each DM + unread counts.
    const allMems = await ChatMembership.findAll({ where: { conversationId: { [Op.in]: convIds } } });
    const otherByConv = {};
    for (const m of allMems) { if (m.userId !== me) otherByConv[m.conversationId] = m.userId; }
    const otherIds = [...new Set(Object.values(otherByConv))];
    const users = await HrUser.findAll({ where: { id: { [Op.in]: otherIds.length ? otherIds : [0] } } });
    const userById = {}; users.forEach((u) => { userById[u.id] = u; });
    const myMemByConv = {}; mems.forEach((m) => { myMemByConv[m.conversationId] = m; });
    const out = [];
    for (const c of convs) {
      const otherId = otherByConv[c.id];
      const other = userById[otherId];
      // Unread = messages after my lastReadAt, not sent by me.
      const lastRead = myMemByConv[c.id] && myMemByConv[c.id].lastReadAt;
      const unread = await ChatMessage.count({ where: { conversationId: c.id, deleted: false, senderId: { [Op.ne]: me }, ...(lastRead ? { createdAt: { [Op.gt]: lastRead } } : {}) } });
      out.push({
        id: c.id, kind: c.kind, other: pubUser(other),
        lastMessageText: c.lastMessageText, lastMessageAt: c.lastMessageAt, lastMessageBy: c.lastMessageBy,
        unread,
      });
    }
    res.json({ conversations: out });
  } catch (e) { next(e); }
});

// ---- Open (or create) a DM with a user, return its id -----------------------
router.post('/dm/:userId', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const other = Number(req.params.userId);
    if (!me) return res.status(403).json({ error: 'Your admin account has no matching HR profile, so chat isn’t available. Ask HR to add you as an employee to use chat.' });
    if (other === me) return res.status(400).json({ error: 'You can’t message yourself.' });
    const target = await HrUser.findByPk(other);
    if (!target || !target.active) return res.status(404).json({ error: 'Person not found.' });
    const dmKey = dmKeyFor(me, other);
    let conv = await ChatConversation.findOne({ where: { dmKey } });
    if (!conv) {
      conv = await ChatConversation.create({ kind: 'dm', dmKey });
      await ChatMembership.bulkCreate([{ conversationId: conv.id, userId: me }, { conversationId: conv.id, userId: other }]);
    } else {
      // Un-hide it for me if I'd closed it before.
      await ChatMembership.update({ hidden: false }, { where: { conversationId: conv.id, userId: me } });
    }
    res.json({ conversation: { id: conv.id, kind: 'dm', other: pubUser(target) } });
  } catch (e) { next(e); }
});

// ---- Messages in a conversation (paginated, newest last) --------------------
router.get('/conversations/:id/messages', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const convId = Number(req.params.id);
    const mem = await ChatMembership.findOne({ where: { conversationId: convId, userId: me } });
    if (!mem) return res.status(403).json({ error: 'Not your conversation.' });
    const before = Number(req.query.before) || null; // message id for pagination
    const where = { conversationId: convId, deleted: false };
    if (before) where.id = { [Op.lt]: before };
    const rows = await ChatMessage.findAll({ where, order: [['id', 'DESC']], limit: 40 });
    rows.reverse();
    res.json({ messages: rows.map((m) => m.toJSON()), hasMore: rows.length === 40 });
  } catch (e) { next(e); }
});

// ---- Send a message (text and/or a file) ------------------------------------
router.post('/conversations/:id/messages', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const convId = Number(req.params.id);
    const mem = await ChatMembership.findOne({ where: { conversationId: convId, userId: me } });
    if (!mem) return res.status(403).json({ error: 'Not your conversation.' });
    const b = req.body || {};
    const body = String(b.body || '').slice(0, 8000).trim();
    const hasFile = !!(b.fileUrl && b.fileName);
    if (!body && !hasFile) return res.status(400).json({ error: 'Nothing to send.' });
    // Resolve @mentions: match "@Name" against conversation members.
    let mentions = [];
    if (body.includes('@')) {
      const memRows = await ChatMembership.findAll({ where: { conversationId: convId } });
      const us = await HrUser.findAll({ where: { id: { [Op.in]: memRows.map((m) => m.userId) } }, attributes: ['id', 'name'] });
      const low = body.toLowerCase();
      for (const u of us) { if (u.id !== me && low.includes('@' + u.name.toLowerCase())) mentions.push(u.id); }
    }
    const msg = await ChatMessage.create({
      conversationId: convId, senderId: me, senderName: meName(req), body,
      fileUrl: hasFile ? String(b.fileUrl).slice(0, 600) : '', fileName: hasFile ? String(b.fileName).slice(0, 200) : '',
      fileType: hasFile ? String(b.fileType || '').slice(0, 60) : '', fileSize: hasFile ? Math.max(0, Number(b.fileSize) || 0) : 0,
      isImage: hasFile ? !!b.isImage : false, mentions,
    });
    // Notify @mentioned people via the HRMS notification bell.
    if (mentions.length) { try { const { HrNotification } = require('../models'); for (const uid of mentions) await HrNotification.create({ userId: uid, actorKind: 'hr', type: 'info', text: `💬 ${meName(req)} mentioned you in chat` }); } catch {} }
    // Update the conversation's last-message summary + un-hide for everyone.
    const summary = body ? body.slice(0, 200) : (hasFile ? `📎 ${msg.fileName}` : '');
    await ChatConversation.update({ lastMessageAt: msg.createdAt, lastMessageText: summary, lastMessageBy: me }, { where: { id: convId } });
    await ChatMembership.update({ hidden: false }, { where: { conversationId: convId } });
    // Mark my own read pointer forward (I've seen my own message).
    await ChatMembership.update({ lastReadAt: msg.createdAt }, { where: { conversationId: convId, userId: me } });
    res.json({ message: msg.toJSON() });
  } catch (e) { next(e); }
});

// ---- Mark a conversation read ------------------------------------------------
router.post('/conversations/:id/read', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const convId = Number(req.params.id);
    await ChatMembership.update({ lastReadAt: new Date() }, { where: { conversationId: convId, userId: me } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Hide (close) a DM from my list -----------------------------------------
router.post('/conversations/:id/hide', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    await ChatMembership.update({ hidden: true }, { where: { conversationId: Number(req.params.id), userId: me } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Poll: total unread + optional new messages for an open conversation ----
// Called every few seconds by the client. Cheap: one count + (if a conv is
// open and `after` given) the messages since the last one the client has.
router.get('/poll', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    markSeen(me); // heartbeat — any poll keeps me "online"
    if (!me) return res.json({ totalUnread: 0, messages: [] });
    const mems = await ChatMembership.findAll({ where: { userId: me, hidden: false } });
    let totalUnread = 0;
    for (const m of mems) {
      const n = await ChatMessage.count({ where: { conversationId: m.conversationId, deleted: false, senderId: { [Op.ne]: me }, ...(m.lastReadAt ? { createdAt: { [Op.gt]: m.lastReadAt } } : {}) } });
      totalUnread += n;
    }
    let messages = [];
    let typing = [];
    let reactions = [];
    const convId = Number(req.query.conversationId) || null;
    const after = Number(req.query.after) || null;
    if (convId) {
      const mine = mems.find((m) => m.conversationId === convId) || await ChatMembership.findOne({ where: { conversationId: convId, userId: me } });
      if (mine) {
        const where = { conversationId: convId, deleted: false };
        if (after) where.id = { [Op.gt]: after };
        const rows = await ChatMessage.findAll({ where, order: [['id', 'ASC']], limit: 60 });
        messages = rows.map((r) => r.toJSON());
        // Reaction/edit deltas for the recent window so others' reactions appear.
        const recent = await ChatMessage.findAll({ where: { conversationId: convId }, order: [['id', 'DESC']], limit: 30 });
        reactions = recent.map((r) => ({ id: r.id, reactions: r.reactions || {}, deleted: r.deleted }));
        // Who's typing here (names, excluding me).
        const t = typingUsers(convId, me);
        if (t.length) { const us = await HrUser.findAll({ where: { id: { [Op.in]: t } }, attributes: ['name'] }); typing = us.map((u) => u.name); }
      }
    }
    res.json({ totalUnread, messages, typing, reactions });
  } catch (e) { next(e); }
});

// ===== TEAMS + CHANNELS (Phase 2) =====
// Only admins & HR may create teams. Anyone in a team can create channels.
function isAdminOrHr(req) { return !!req._chatCanManage; }

// List teams I'm in (or all public teams), each with its channels + unread.
router.get('/teams', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    if (!me) return res.json({ teams: [], canCreateTeam: isAdminOrHr(req), canManage: isAdminOrHr(req) });
    const myTeamRows = await ChatTeamMember.findAll({ where: { userId: me } });
    const myTeamIds = new Set(myTeamRows.map((r) => r.teamId));
    // Every team is private — only show teams I'm a member of. (HR/Admin manage
    // membership; there's no self-join.)
    if (!myTeamIds.size) return res.json({ teams: [], canCreateTeam: isAdminOrHr(req), canManage: isAdminOrHr(req) });
    const teams = await ChatTeam.findAll({ where: { archived: false, id: { [Op.in]: [...myTeamIds] } }, order: [['name', 'ASC']] });
    const out = [];
    for (const t of teams) {
      // Channels I'm a member of within this team.
      const chans = await ChatConversation.findAll({ where: { kind: 'channel', teamId: t.id }, order: [['createdAt', 'ASC']] });
      const chanOut = [];
      for (const c of chans) {
        const cm = await ChatMembership.findOne({ where: { conversationId: c.id, userId: me } });
        if (!cm) continue; // only groups I'm in
        const unread = await ChatMessage.count({ where: { conversationId: c.id, deleted: false, senderId: { [Op.ne]: me }, ...(cm.lastReadAt ? { createdAt: { [Op.gt]: cm.lastReadAt } } : {}) } });
        chanOut.push({ id: c.id, title: c.title, visibility: c.visibility, unread, lastMessageAt: c.lastMessageAt });
      }
      out.push({ id: t.id, name: t.name, icon: t.icon || t.name.charAt(0).toUpperCase(), color: t.color, member: true, channels: chanOut });
    }
    res.json({ teams: out, canCreateTeam: isAdminOrHr(req), canManage: isAdminOrHr(req) });
  } catch (e) { next(e); }
});

// Admin/HR: create a team (+ a default #general channel, creator joins).
router.post('/teams', requireHrAccess, async (req, res, next) => {
  try {
    if (!isAdminOrHr(req)) return res.status(403).json({ error: 'Only Admin & HR can create teams.' });
    const creator = meId(req);
    if (!creator) return res.status(403).json({ error: 'Your admin account has no matching HR profile. Ask HR to add you as an employee first.' });
    const b = req.body || {};
    const name = String(b.name || '').slice(0, 80).trim();
    if (!name) return res.status(400).json({ error: 'Team name is required.' });
    const team = await ChatTeam.create({ name, icon: String(b.icon || name.charAt(0).toUpperCase()).slice(0, 8), color: String(b.color || '#FF6A00').slice(0, 20), description: String(b.description || '').slice(0, 300), visibility: 'private', createdById: creator });
    // Members = the selected employees + the creator (always). Dedupe + drop nulls.
    const picked = Array.isArray(b.memberIds) ? b.memberIds.map(Number).filter(Boolean) : [];
    const memberIds = [...new Set([creator, ...picked])];
    await ChatTeamMember.bulkCreate(memberIds.map((uid) => ({ teamId: team.id, userId: uid, role: uid === creator ? 'owner' : 'member' })));
    // Default #general channel with all the team members.
    const conv = await ChatConversation.create({ kind: 'channel', teamId: team.id, title: 'general' });
    await ChatMembership.bulkCreate(memberIds.map((uid) => ({ conversationId: conv.id, userId: uid })));
    res.status(201).json({ team: team.toJSON() });
  } catch (e) { next(e); }
});

// Create a channel in a team (any team member can).
router.post('/teams/:teamId/channels', requireHrAccess, async (req, res, next) => {
  try {
    if (!isAdminOrHr(req)) return res.status(403).json({ error: 'Only Admin & HR can create groups.' });
    const me = meId(req);
    if (!me) return res.status(403).json({ error: 'Your admin account has no matching HR profile.' });
    const teamId = Number(req.params.teamId);
    const team = await ChatTeam.findByPk(teamId);
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    const b = req.body || {};
    const name = String(b.name || '').slice(0, 60).trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
    if (!name) return res.status(400).json({ error: 'Group name is required.' });
    const teamMembers = await ChatTeamMember.findAll({ where: { teamId } });
    const teamMemberIds = teamMembers.map((tm) => tm.userId);
    // Team-wide = all team members; Private = only the selected ones (+creator).
    let memberIds;
    if (b.visibility === 'private') {
      const picked = Array.isArray(b.memberIds) ? b.memberIds.map(Number).filter(Boolean) : [];
      memberIds = [...new Set([me, ...picked])].filter((id) => teamMemberIds.includes(id) || id === me);
    } else {
      memberIds = [...new Set([me, ...teamMemberIds])];
    }
    const conv = await ChatConversation.create({ kind: 'channel', teamId, title: name, visibility: b.visibility === 'private' ? 'private' : 'team' });
    await ChatMembership.bulkCreate(memberIds.map((uid) => ({ conversationId: conv.id, userId: uid })));
    res.status(201).json({ channel: { id: conv.id, title: name } });
  } catch (e) { next(e); }
});

// HR/Admin: list a team's members + who's addable (for the manage-members UI).
router.get('/teams/:teamId/members', requireHrAccess, async (req, res, next) => {
  try {
    if (!isAdminOrHr(req)) return res.status(403).json({ error: 'Only Admin & HR can manage members.' });
    const teamId = Number(req.params.teamId);
    const rows = await ChatTeamMember.findAll({ where: { teamId } });
    const ids = rows.map((r) => r.userId);
    const members = await HrUser.findAll({ where: { id: { [Op.in]: ids.length ? ids : [0] } }, attributes: ['id', 'name', 'avatar', 'department', 'designation'] });
    const roleById = {}; rows.forEach((r) => { roleById[r.userId] = r.role; });
    res.json({ members: members.map((u) => ({ ...pubUser(u), role: roleById[u.id] || 'member' })) });
  } catch (e) { next(e); }
});

// HR/Admin: add employees to a team (and its team-wide channels).
router.post('/teams/:teamId/members', requireHrAccess, async (req, res, next) => {
  try {
    if (!isAdminOrHr(req)) return res.status(403).json({ error: 'Only Admin & HR can manage members.' });
    const teamId = Number(req.params.teamId);
    const team = await ChatTeam.findByPk(teamId);
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    const ids = Array.isArray((req.body || {}).userIds) ? req.body.userIds.map(Number).filter(Boolean) : [];
    for (const uid of ids) { await ChatTeamMember.findOrCreate({ where: { teamId, userId: uid }, defaults: { teamId, userId: uid } }); }
    // Add them to the team-wide (non-private) channels.
    const chans = await ChatConversation.findAll({ where: { kind: 'channel', teamId, visibility: { [Op.ne]: 'private' } } });
    for (const c of chans) for (const uid of ids) await ChatMembership.findOrCreate({ where: { conversationId: c.id, userId: uid }, defaults: { conversationId: c.id, userId: uid } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// HR/Admin: remove an employee from a team (and all its channels).
router.delete('/teams/:teamId/members/:userId', requireHrAccess, async (req, res, next) => {
  try {
    if (!isAdminOrHr(req)) return res.status(403).json({ error: 'Only Admin & HR can manage members.' });
    const teamId = Number(req.params.teamId);
    const uid = Number(req.params.userId);
    await ChatTeamMember.destroy({ where: { teamId, userId: uid } });
    const chans = await ChatConversation.findAll({ where: { kind: 'channel', teamId } });
    for (const c of chans) await ChatMembership.destroy({ where: { conversationId: c.id, userId: uid } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// HR/Admin: add / remove members of a specific group (channel).
router.post('/channels/:id/members', requireHrAccess, async (req, res, next) => {
  try {
    if (!isAdminOrHr(req)) return res.status(403).json({ error: 'Only Admin & HR can manage members.' });
    const convId = Number(req.params.id);
    const conv = await ChatConversation.findByPk(convId);
    if (!conv || conv.kind !== 'channel') return res.status(404).json({ error: 'Group not found.' });
    const b = req.body || {};
    if (Array.isArray(b.add)) { for (const uid of b.add.map(Number).filter(Boolean)) { await ChatMembership.findOrCreate({ where: { conversationId: convId, userId: uid }, defaults: { conversationId: convId, userId: uid } }); await ChatTeamMember.findOrCreate({ where: { teamId: conv.teamId, userId: uid }, defaults: { teamId: conv.teamId, userId: uid } }); } }
    if (Array.isArray(b.remove)) { for (const uid of b.remove.map(Number).filter(Boolean)) await ChatMembership.destroy({ where: { conversationId: convId, userId: uid } }); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Channel info (title, team, members) for the conversation header.
router.get('/channels/:id/info', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const convId = Number(req.params.id);
    const conv = await ChatConversation.findByPk(convId);
    if (!conv || conv.kind !== 'channel') return res.status(404).json({ error: 'Channel not found.' });
    const mem = await ChatMembership.findOne({ where: { conversationId: convId, userId: me } });
    if (!mem) return res.status(403).json({ error: 'Not a member.' });
    const team = conv.teamId ? await ChatTeam.findByPk(conv.teamId) : null;
    const memRows = await ChatMembership.findAll({ where: { conversationId: convId } });
    const users = await HrUser.findAll({ where: { id: { [Op.in]: memRows.map((m) => m.userId) } } });
    res.json({ id: conv.id, title: conv.title, team: team ? { id: team.id, name: team.name, icon: team.icon, color: team.color } : null, members: users.map(pubUser) });
  } catch (e) { next(e); }
});

// ===== Phase 3: reactions, typing, search, @mention members =====

// Add / toggle a reaction on a message.
router.post('/messages/:id/react', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const msg = await ChatMessage.findByPk(Number(req.params.id));
    if (!msg) return res.status(404).json({ error: 'Message not found.' });
    const mem = await ChatMembership.findOne({ where: { conversationId: msg.conversationId, userId: me } });
    if (!mem) return res.status(403).json({ error: 'Not your conversation.' });
    const emoji = String((req.body || {}).emoji || '').slice(0, 8);
    if (!emoji) return res.status(400).json({ error: 'No emoji.' });
    const r = { ...(msg.reactions || {}) };
    const arr = new Set(r[emoji] || []);
    if (arr.has(me)) arr.delete(me); else arr.add(me);       // toggle
    if (arr.size) r[emoji] = [...arr]; else delete r[emoji];
    msg.reactions = r; msg.changed('reactions', true); await msg.save();
    res.json({ reactions: msg.reactions });
  } catch (e) { next(e); }
});

// Typing heartbeat.
router.post('/conversations/:id/typing', requireHrAccess, async (req, res, next) => {
  try { const me = meId(req); markSeen(me); setTyping(Number(req.params.id), me); res.json({ ok: true }); } catch (e) { next(e); }
});

// Search my messages (simple LIKE), labelled by conversation.
router.get('/search', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const term = String(req.query.q || '').trim();
    if (term.length < 2) return res.json({ results: [] });
    const mems = await ChatMembership.findAll({ where: { userId: me, hidden: false } });
    const convIds = mems.map((m) => m.conversationId);
    if (!convIds.length) return res.json({ results: [] });
    const rows = await ChatMessage.findAll({ where: { conversationId: { [Op.in]: convIds }, deleted: false, body: { [Op.like]: `%${term}%` } }, order: [['id', 'DESC']], limit: 30 });
    const convs = await ChatConversation.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((r) => r.conversationId))].length ? [...new Set(rows.map((r) => r.conversationId))] : [0] } } });
    const convById = {}; convs.forEach((c) => { convById[c.id] = c; });
    const dmConvIds = convs.filter((c) => c.kind === 'dm').map((c) => c.id);
    const dmMems = await ChatMembership.findAll({ where: { conversationId: { [Op.in]: dmConvIds.length ? dmConvIds : [0] }, userId: { [Op.ne]: me } } });
    const otherByConv = {}; dmMems.forEach((m) => { if (!otherByConv[m.conversationId]) otherByConv[m.conversationId] = m.userId; });
    const others = await HrUser.findAll({ where: { id: { [Op.in]: Object.values(otherByConv).length ? Object.values(otherByConv) : [0] } }, attributes: ['id', 'name'] });
    const otherName = {}; others.forEach((u) => { otherName[u.id] = u.name; });
    const results = rows.map((r) => { const c = convById[r.conversationId]; const label = c && c.kind === 'channel' ? `#${c.title}` : (otherName[otherByConv[r.conversationId]] || 'Direct message'); return { id: r.id, conversationId: r.conversationId, body: r.body, senderName: r.senderName, createdAt: r.createdAt, label, kind: c ? c.kind : 'dm', other: c && c.kind === 'dm' ? { id: otherByConv[r.conversationId], name: otherName[otherByConv[r.conversationId]] } : null }; });
    res.json({ results });
  } catch (e) { next(e); }
});

// Members of a conversation (for @mention autocomplete) + online status.
router.get('/conversations/:id/members', requireHrAccess, async (req, res, next) => {
  try {
    const me = meId(req);
    const convId = Number(req.params.id);
    const mem = await ChatMembership.findOne({ where: { conversationId: convId, userId: me } });
    if (!mem) return res.status(403).json({ error: 'Not your conversation.' });
    const rows = await ChatMembership.findAll({ where: { conversationId: convId } });
    const users = await HrUser.findAll({ where: { id: { [Op.in]: rows.map((m) => m.userId) } }, attributes: ['id', 'name', 'avatar', 'department', 'designation'] });
    res.json({ members: users.map((u) => ({ ...pubUser(u), online: isOnline(u.id) })) });
  } catch (e) { next(e); }
});

module.exports = router;
