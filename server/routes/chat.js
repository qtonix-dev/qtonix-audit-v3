/**
 * Company Chat (Workspace) — Phase 1: direct messages + file sharing.
 * Built on HrUser accounts. Real-time via short-polling (GET /poll).
 */
const express = require('express');
const router = express.Router();
const { Op, HrUser, ChatConversation, ChatMembership, ChatMessage } = require('../models');
const { requireHrAccess } = require('../middleware/hrAuth');

// The chat identity is the logged-in HR user.
function meId(req) { return req.hrUser ? req.hrUser.id : null; }
function dmKeyFor(a, b) { const [x, y] = [Number(a), Number(b)].sort((m, n) => m - n); return `${x}-${y}`; }

// Small helper: shape a user for the client (id, name, avatar, role bits).
function pubUser(u) { return u ? { id: u.id, name: u.name, avatar: u.avatar || '', department: u.department || '', designation: u.designation || '' } : null; }

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
    if (!me) return res.status(403).json({ error: 'Sign in to chat.' });
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
    const msg = await ChatMessage.create({
      conversationId: convId, senderId: me, senderName: req.hrUser.name, body,
      fileUrl: hasFile ? String(b.fileUrl).slice(0, 600) : '', fileName: hasFile ? String(b.fileName).slice(0, 200) : '',
      fileType: hasFile ? String(b.fileType || '').slice(0, 60) : '', fileSize: hasFile ? Math.max(0, Number(b.fileSize) || 0) : 0,
      isImage: hasFile ? !!b.isImage : false,
    });
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
    if (!me) return res.json({ totalUnread: 0, messages: [] });
    const mems = await ChatMembership.findAll({ where: { userId: me, hidden: false } });
    let totalUnread = 0;
    for (const m of mems) {
      const n = await ChatMessage.count({ where: { conversationId: m.conversationId, deleted: false, senderId: { [Op.ne]: me }, ...(m.lastReadAt ? { createdAt: { [Op.gt]: m.lastReadAt } } : {}) } });
      totalUnread += n;
    }
    let messages = [];
    const convId = Number(req.query.conversationId) || null;
    const after = Number(req.query.after) || null;
    if (convId) {
      const mine = mems.find((m) => m.conversationId === convId) || await ChatMembership.findOne({ where: { conversationId: convId, userId: me } });
      if (mine) {
        const where = { conversationId: convId, deleted: false };
        if (after) where.id = { [Op.gt]: after };
        const rows = await ChatMessage.findAll({ where, order: [['id', 'ASC']], limit: 60 });
        messages = rows.map((r) => r.toJSON());
      }
    }
    res.json({ totalUnread, messages });
  } catch (e) { next(e); }
});

module.exports = router;
