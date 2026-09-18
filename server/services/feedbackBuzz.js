/**
 * Sends a friendly Buzz (chat) DM to a person when their bug/suggestion is
 * resolved. The DM comes from an HR sender (first HR user, else first admin's
 * chatOnly HrUser). Best-effort — never throws into the caller.
 */
const dmKeyFor = (a, b) => { const [x, y] = [Number(a), Number(b)].sort((m, n) => m - n); return `${x}-${y}`; };

async function pickSender(models, exceptId) {
  const { HrUser } = models;
  // Prefer a real HR user; fall back to any manager/admin chatOnly HrUser.
  let sender = await HrUser.findOne({ where: { type: 'hr', active: true } });
  if (!sender) sender = await HrUser.findOne({ where: { active: true, chatOnly: true } });
  if (!sender) sender = await HrUser.findOne({ where: { active: true } });
  if (sender && Number(sender.id) === Number(exceptId)) {
    // Don't DM from the same person to themselves — find someone else.
    const alt = await HrUser.findOne({ where: { active: true, id: { [require('sequelize').Op.ne]: exceptId } } });
    if (alt) sender = alt;
  }
  return sender;
}

async function sendResolutionDm(models, { reporterId, kind, verb, icon, snippet, noteLine }) {
  const { HrUser, ChatConversation, ChatMembership, ChatMessage } = models;
  const reporter = await HrUser.findByPk(reporterId);
  if (!reporter || !reporter.active) return false;
  const sender = await pickSender(models, reporterId);
  if (!sender) return false;

  const dmKey = dmKeyFor(sender.id, reporterId);
  let conv = await ChatConversation.findOne({ where: { dmKey } });
  if (!conv) {
    conv = await ChatConversation.create({ kind: 'dm', dmKey });
    await ChatMembership.bulkCreate([
      { conversationId: conv.id, userId: sender.id },
      { conversationId: conv.id, userId: reporterId },
    ]);
  } else {
    // Un-hide for both so it surfaces in their sidebar.
    await ChatMembership.update({ hidden: false }, { where: { conversationId: conv.id } });
  }
  const what = kind === 'bug' ? 'bug you reported' : (kind === 'suggestion' ? 'suggestion you shared' : 'report you sent');
  const body = `${icon} Good news! The ${what} has been ${verb}${snippet ? ` — "${snippet}"` : ''}. Thanks for helping make QHub better! 🙏${noteLine || ''}`;
  const msg = await ChatMessage.create({ conversationId: conv.id, senderId: sender.id, body, kindTag: 'feedback_resolved' });
  // Bump the conversation's updatedAt so it sorts to the top.
  try { conv.changed('updatedAt', true); await conv.save(); } catch {}
  return !!msg;
}

module.exports = { sendResolutionDm };
