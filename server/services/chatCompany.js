/**
 * Company-wide Buzz channel — "#the-hub".
 * A single shared conversation that every active employee belongs to. Used for
 * celebrations (birthdays, anniversaries, new joinees), recognition/helping-hand
 * shout-outs, company announcements, and surveys — and it's a fully-open group
 * where anyone can post, reply, and react.
 *
 * postCompanyCard() drops a color-coded system card (kindTag) into the channel,
 * with de-duplication so scheduled jobs never double-post the same event/day.
 */
const { Op, ChatConversation, ChatMembership, ChatMessage, HrUser } = require('../models');

const HUB_KEY = 'company-hub';
const HUB_TITLE = 'the-hub';

// Get (or lazily create) the single company-wide conversation id, and make sure
// every active, non-chatOnly employee is a member.
async function companyChannel({ ensureMembers = true } = {}) {
  let conv = await ChatConversation.findOne({ where: { kind: 'channel', dmKey: HUB_KEY } });
  if (!conv) {
    conv = await ChatConversation.create({ kind: 'channel', dmKey: HUB_KEY, title: HUB_TITLE });
  }
  if (ensureMembers) {
    try {
      const users = await HrUser.findAll({ where: { active: true, chatOnly: { [Op.not]: true } }, attributes: ['id'] });
      const existing = new Set((await ChatMembership.findAll({ where: { conversationId: conv.id }, attributes: ['userId'] })).map((m) => m.userId));
      const toAdd = users.filter((u) => !existing.has(u.id)).map((u) => ({ conversationId: conv.id, userId: u.id }));
      if (toAdd.length) await ChatMembership.bulkCreate(toAdd);
    } catch { /* non-fatal */ }
  }
  return conv.id;
}

// Ensure a single user is a member (called on login / first chat load).
async function ensureHubMembership(userId) {
  if (!userId || userId <= 0) return;
  try {
    const convId = await companyChannel({ ensureMembers: false });
    await ChatMembership.findOrCreate({ where: { conversationId: convId, userId }, defaults: { conversationId: convId, userId } });
  } catch { /* non-fatal */ }
}

// Post a color-coded system card into #the-hub. `dedupeKey` (optional) prevents
// duplicate posts for the same event on the same day (scheduled jobs).
async function postCompanyCard({ kindTag, body, meta = {}, dedupeKey = null }) {
  try {
    const convId = await companyChannel();
    if (!convId) return null;
    if (dedupeKey) {
      const since = new Date(Date.now() - 36 * 3600 * 1000); // ~1.5 days window
      const dupe = await ChatMessage.findOne({ where: { conversationId: convId, kindTag, createdAt: { [Op.gt]: since }, dedupeKey } });
      if (dupe) return null;
    }
    const msg = await ChatMessage.create({
      conversationId: convId, senderId: 0, senderName: 'Qtonix',
      body: String(body || '').slice(0, 500), kindTag, dedupeKey: dedupeKey || null,
    });
    await ChatConversation.update({ lastMessageAt: msg.createdAt, lastMessageText: String(body || '').slice(0, 200), lastMessageBy: 0 }, { where: { id: convId } });
    return msg;
  } catch (e) { /* never break the caller on a chat hiccup */ }
}

module.exports = { companyChannel, ensureHubMembership, postCompanyCard, HUB_KEY, HUB_TITLE };
