/**
 * Chat ↔ Task bridge.
 * - Every employee has a private #task conversation (kind='task', one membership:
 *   themselves). It's their personal notepad AND where task alerts land.
 * - postTaskAlert() drops an assignment / status-change card into the assignee's
 *   #task channel only (private to them).
 */
const { ChatConversation, ChatMembership, ChatMessage } = require('../models');

// Get (or lazily create) a user's personal #task conversation id.
async function taskChannelFor(userId) {
  if (!userId) return null;
  const key = `task-${userId}`;
  let conv = await ChatConversation.findOne({ where: { kind: 'task', dmKey: key } });
  if (!conv) {
    conv = await ChatConversation.create({ kind: 'task', dmKey: key, title: 'task' });
    await ChatMembership.create({ conversationId: conv.id, userId });
  } else {
    // Self-heal: ensure the membership exists.
    await ChatMembership.findOrCreate({ where: { conversationId: conv.id, userId }, defaults: { conversationId: conv.id, userId } });
  }
  return conv.id;
}

// Post a task alert into the assignee's #task channel. kindTag =
// 'task_assigned' | 'task_status'. Links the message to the task.
async function postTaskAlert(assigneeId, { kindTag, taskId, body }) {
  try {
    if (!assigneeId) return;
    const convId = await taskChannelFor(assigneeId);
    if (!convId) return;
    const msg = await ChatMessage.create({
      conversationId: convId, senderId: 0, senderName: 'Tasks',
      body: String(body || '').slice(0, 500), kindTag, taskId: taskId || null,
    });
    await ChatConversation.update({ lastMessageAt: msg.createdAt, lastMessageText: String(body || '').slice(0, 200), lastMessageBy: 0 }, { where: { id: convId } });
    return msg;
  } catch (e) { /* never break the task flow on a chat hiccup */ }
}

module.exports = { taskChannelFor, postTaskAlert };
