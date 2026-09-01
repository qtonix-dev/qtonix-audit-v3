/**
 * Seed the RewardRule table with the initial economy from the spec.
 *
 * Idempotent: rules are keyed by `key`, so re-running only inserts missing ones
 * and never overwrites values an admin has since tweaked. Point values follow
 * the document's recommendations (ranged rewards store the min in `points` and
 * the max in `pointsMax`).
 */

// The full badge library (existing 8 + new). key = `badge_<id>`; the <id> also
// matches the recognition badge id so awarding a badge finds its rule.
const BADGES = [
  // Customer & service
  { id: 'customer_hero', name: 'Customer Hero', icon: '⭐', color: '#F59E0B', points: 500, desc: 'Exceptional customer service or client support' },
  { id: 'customer_champion', name: 'Customer Champion', icon: '❤️', color: '#DC2626', points: 750, desc: 'Repeatedly creating excellent customer experiences' },
  { id: 'client_success_hero', name: 'Client Success Hero', icon: '🎯', color: '#0EA5E9', points: 1000, desc: 'Directly contributing to client success or retention' },
  { id: 'service_excellence', name: 'Service Excellence', icon: '📞', color: '#2563EB', points: 500, desc: 'Exceptional handling of a difficult customer situation' },
  // Performance
  { id: 'star_performer', name: 'Star Performer', icon: '🌟', color: '#EA580C', points: 750, desc: 'Consistently exceptional performance' },
  { id: 'above_beyond', name: 'Above & Beyond', icon: '🚀', color: '#2563EB', points: 500, desc: 'Doing significantly more than expected' },
  { id: 'exceptional_performer', name: 'Exceptional Performer', icon: '🏆', color: '#CA8A04', points: 1000, desc: 'Achievement substantially beyond normal expectations' },
  { id: 'major_impact', name: 'Major Impact', icon: '💎', color: '#7C3AED', points: 2000, desc: 'Work that creates significant business/team impact' },
  { id: 'target_crusher', name: 'Target Crusher', icon: '🎯', color: '#16A34A', points: 500, pointsMax: 1500, desc: 'Exceptional achievement against measurable targets' },
  { id: 'goal_getter', name: 'Goal Getter', icon: '🔥', color: '#EA580C', points: 500, desc: 'Achieving an important business or departmental goal' },
  // Teamwork & culture
  { id: 'team_player', name: 'Team Player', icon: '🤝', color: '#0EA5E9', points: 250, desc: 'Consistently supporting the team' },
  { id: 'collaboration_champion', name: 'Collaboration Champion', icon: '🧑‍🤝‍🧑', color: '#0284C7', points: 500, desc: 'Exceptional cross-team collaboration' },
  { id: 'culture_champion', name: 'Culture Champion', icon: '🌱', color: '#16A34A', points: 500, desc: 'Demonstrating and strengthening Qtonix culture' },
  { id: 'people_supporter', name: 'People Supporter', icon: '🫶', color: '#DB2777', points: 250, desc: 'Consistently supporting colleagues in difficult times' },
  // Reliability & ownership
  { id: 'ever_reliable', name: 'Ever Reliable', icon: '🛡️', color: '#475569', points: 250, desc: 'Consistently dependable work' },
  { id: 'ownership_champion', name: 'Ownership Champion', icon: '🔐', color: '#334155', points: 500, desc: 'Taking complete ownership of a problem/project' },
  { id: 'deadline_hero', name: 'Deadline Hero', icon: '⏱️', color: '#0891B2', points: 500, desc: 'Completing an important task under a tight deadline' },
  { id: 'resilience_champion', name: 'Resilience Champion', icon: '🧗', color: '#7C3AED', points: 500, desc: 'Maintaining performance during a difficult situation' },
  { id: 'commitment_champion', name: 'Commitment Champion', icon: '🏅', color: '#CA8A04', points: 500, desc: 'Exceptional commitment to a project, customer or team' },
  // Problem solving & innovation
  { id: 'problem_solver', name: 'Problem Solver', icon: '🧩', color: '#16A34A', points: 250, desc: 'Solving a difficult or unusual problem' },
  { id: 'innovator', name: 'Innovator', icon: '💡', color: '#7C3AED', points: 500, desc: 'Introducing a useful new idea' },
  { id: 'process_improver', name: 'Process Improver', icon: '⚙️', color: '#475569', points: 500, desc: 'Improving an existing process' },
  { id: 'automation_champion', name: 'Automation Champion', icon: '🤖', color: '#0EA5E9', points: 750, pointsMax: 2000, desc: 'Creating automation that improves productivity' },
  { id: 'cost_saver', name: 'Cost Saver', icon: '💰', color: '#16A34A', points: 500, pointsMax: 2500, desc: 'Creating a measurable cost-saving opportunity' },
  { id: 'game_changer', name: 'Game Changer', icon: '🚀', color: '#DC2626', points: 2500, pointsMax: 5000, desc: 'An initiative that creates major company-wide impact' },
  // Learning & development
  { id: 'quick_learner', name: 'Quick Learner', icon: '📚', color: '#DB2777', points: 250, desc: 'Picking things up fast' },
  { id: 'knowledge_champion', name: 'Knowledge Champion', icon: '🎓', color: '#7C3AED', points: 500, desc: 'Completing meaningful professional development' },
  { id: 'knowledge_sharer', name: 'Knowledge Sharer', icon: '🧠', color: '#0284C7', points: 250, pointsMax: 500, desc: 'Sharing useful knowledge with the team' },
  { id: 'mentor', name: 'Mentor', icon: '👨‍🏫', color: '#CA8A04', points: 500, pointsMax: 1000, desc: 'Consistently mentoring junior employees' },
  // Special recognition
  { id: 'leadership_excellence', name: 'Leadership Excellence', icon: '👑', color: '#CA8A04', points: 1000, desc: 'Exceptional leadership' },
  { id: 'rising_star', name: 'Rising Star', icon: '🌟', color: '#EA580C', points: 500, desc: 'Exceptional growth and potential' },
  { id: 'unsung_hero', name: 'Unsung Hero', icon: '🏆', color: '#64748B', points: 500, desc: 'Valuable contribution that happens behind the scenes' },
  { id: 'qtonix_champion', name: 'Qtonix Champion', icon: '🌟', color: '#B45309', points: 2500, pointsMax: 5000, desc: 'Highest-level recognition (needs senior mgmt approval)', requiresApproval: true, approvalLevel: 'senior_mgmt' },
];

// Base non-badge rules — appreciation, thank-you, and the automatic rewards.
const BASE_RULES = [
  { key: 'appreciation_plain', name: 'Appreciation (no badge)', category: 'appreciation', icon: '❤️', color: '#DC2626', points: 100, desc: 'Simple appreciation with a reason', frequency: 'unlimited', approvalLevel: 'manager' },
  { key: 'thank_you', name: 'Thank You', category: 'appreciation', icon: '❤️', color: '#F472B6', points: 50, desc: 'Small but meaningful contribution', frequency: 'unlimited', approvalLevel: 'manager' },
  { key: 'auto_birthday', name: 'Birthday reward', category: 'automatic', icon: '🎂', color: '#DB2777', points: 500, desc: 'Awarded automatically on birthday', frequency: 'yearly', approvalLevel: 'auto' },
  { key: 'auto_joining', name: 'Joining reward (30 days)', category: 'automatic', icon: '🎉', color: '#16A34A', points: 500, desc: 'Awarded after completing 30 days', frequency: 'once', approvalLevel: 'auto' },
  // Work-anniversary tiers (year → points).
  { key: 'auto_anniversary_1', name: '1-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 500, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_2', name: '2-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 750, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_3', name: '3-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 1000, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_4', name: '4-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 1500, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_5', name: '5-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 2000, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_6', name: '6-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 2500, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_7', name: '7-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 2500, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_8', name: '8-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 3000, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_9', name: '9-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 3000, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_10', name: '10-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 5000, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_15', name: '15-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 7500, frequency: 'once', approvalLevel: 'auto' },
  { key: 'auto_anniversary_20', name: '20-Year Anniversary', category: 'anniversary', icon: '🎊', color: '#7C3AED', points: 10000, frequency: 'once', approvalLevel: 'auto' },
  // Attendance auto-badge points (optional; disabled by default in config).
  { key: 'attendance_30', name: 'Attendance 30 days', category: 'attendance', icon: '📅', color: '#16A34A', points: 50, frequency: 'once', approvalLevel: 'auto', active: true },
  { key: 'attendance_60', name: 'Attendance 60 days', category: 'attendance', icon: '📆', color: '#0F9D58', points: 100, frequency: 'once', approvalLevel: 'auto', active: true },
  { key: 'attendance_100', name: 'Attendance 100 days', category: 'attendance', icon: '🗓️', color: '#15803D', points: 250, frequency: 'once', approvalLevel: 'auto', active: true },
  // On-time punctuality badges (came on time to office for N days).
  { key: 'ontime_30', name: 'On-time 30 days', category: 'attendance', icon: '⏰', color: '#7C3AED', points: 50, frequency: 'once', approvalLevel: 'auto', active: true },
  { key: 'ontime_60', name: 'On-time 60 days', category: 'attendance', icon: '⏱️', color: '#6D28D9', points: 100, frequency: 'once', approvalLevel: 'auto', active: true },
  { key: 'ontime_100', name: 'On-time 100 days', category: 'attendance', icon: '🎯', color: '#5B21B6', points: 250, frequency: 'once', approvalLevel: 'auto', active: true },
  // Helping Hand — a PEER TRANSFER (50 pts from giver to recipient). Milestone
  // bonuses (3/5/10/20 received) are HR-approved, not automatic.
  { key: 'helping_transfer', name: 'Helping Hand', category: 'helping', icon: '❤️', color: '#DB2777', points: 50, frequency: 'unlimited', approvalLevel: 'auto', desc: 'Peer-to-peer thank you (50 pts moved from your wallet)' },
  { key: 'helping_bonus_3', name: 'Helping Bonus · 3', category: 'helping', icon: '🔥', color: '#EA580C', points: 100, frequency: 'quarterly', approvalLevel: 'hod_hr', desc: 'Bonus for receiving 3 helping hands' },
  { key: 'helping_bonus_5', name: 'Helping Bonus · 5', category: 'helping', icon: '🔥', color: '#EA580C', points: 150, frequency: 'quarterly', approvalLevel: 'hod_hr', desc: 'Bonus for receiving 5 helping hands' },
  { key: 'helping_bonus_10', name: 'Helping Bonus · 10', category: 'helping', icon: '🔥', color: '#DC2626', points: 300, frequency: 'quarterly', approvalLevel: 'hod_hr', desc: 'Bonus for receiving 10 helping hands' },
  { key: 'helping_bonus_20', name: 'Helping Bonus · 20', category: 'helping', icon: '🔥', color: '#DC2626', points: 500, frequency: 'quarterly', approvalLevel: 'hod_hr', desc: 'Bonus for receiving 20 helping hands' },
  // Helping Hand (awarded on approval of a recommendation) + streak milestones.
  // Helping Hand (peer transfer + milestone bonuses) are defined further below
  // in the on-time/helping block; the old award/streak rules are removed.
  // Innovation rewards by impact (spec §19).
  { key: 'innovation_small', name: 'Innovation · Small', category: 'innovation', icon: '💡', color: '#7C3AED', points: 250, frequency: 'per_item', approvalLevel: 'hod_hr' },
  { key: 'innovation_moderate', name: 'Innovation · Moderate', category: 'innovation', icon: '💡', color: '#7C3AED', points: 500, frequency: 'per_item', approvalLevel: 'hod_hr' },
  { key: 'innovation_significant', name: 'Innovation · Significant', category: 'innovation', icon: '💡', color: '#6D28D9', points: 1000, frequency: 'per_item', approvalLevel: 'hod_hr' },
  { key: 'innovation_major', name: 'Innovation · Major', category: 'innovation', icon: '🚀', color: '#DC2626', points: 2500, frequency: 'per_item', approvalLevel: 'senior_mgmt' },
  { key: 'innovation_exceptional', name: 'Innovation · Exceptional', category: 'innovation', icon: '🚀', color: '#B45309', points: 5000, frequency: 'per_item', approvalLevel: 'senior_mgmt' },
  // Performance achievement (ranged) + customer appreciation + learning + mentoring.
  { key: 'performance_achievement', name: 'Performance Achievement', category: 'performance', icon: '🎯', color: '#EA580C', points: 250, pointsMax: 2500, frequency: 'unlimited', approvalLevel: 'hod_hr', desc: 'Exceptional target/project/result' },
  { key: 'customer_appreciation_1', name: 'Customer Appreciation · L1', category: 'customer', icon: '💬', color: '#0EA5E9', points: 500, frequency: 'unlimited', approvalLevel: 'manager' },
  { key: 'customer_appreciation_2', name: 'Customer Appreciation · L2', category: 'customer', icon: '💬', color: '#0284C7', points: 1000, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'customer_appreciation_exceptional', name: 'Customer Appreciation · Exceptional', category: 'customer', icon: '💬', color: '#0369A1', points: 1500, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'learning_internal_training', name: 'Internal Training', category: 'learning', icon: '📖', color: '#7C3AED', points: 100, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'learning_course', name: 'Relevant Course', category: 'learning', icon: '📖', color: '#7C3AED', points: 250, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'learning_certification', name: 'Certification', category: 'learning', icon: '🎓', color: '#6D28D9', points: 500, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'learning_advanced_cert', name: 'Advanced Certification', category: 'learning', icon: '🎓', color: '#5B21B6', points: 1000, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'learning_major_cert', name: 'Major Industry Certification', category: 'learning', icon: '🏆', color: '#5B21B6', points: 1500, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'mentoring_occasional', name: 'Occasional Mentoring', category: 'mentoring', icon: '👨‍🏫', color: '#CA8A04', points: 250, frequency: 'unlimited', approvalLevel: 'manager' },
  { key: 'mentoring_regular', name: 'Regular Mentoring', category: 'mentoring', icon: '👨‍🏫', color: '#CA8A04', points: 500, frequency: 'unlimited', approvalLevel: 'hod_hr' },
  { key: 'mentoring_significant', name: 'Significant Mentoring', category: 'mentoring', icon: '👨‍🏫', color: '#B45309', points: 1000, frequency: 'unlimited', approvalLevel: 'hod_hr' },
];

async function seed(models) {
  const { RewardRule, RewardCatalogueItem } = models;
  let created = 0;
  const rows = [
    ...BADGES.map((b, i) => ({
      key: `badge_${b.id}`, name: b.name, category: 'badge', points: b.points, pointsMax: b.pointsMax || null,
      icon: b.icon, color: b.color, description: b.desc || '', frequency: 'unlimited',
      approvalLevel: b.approvalLevel || 'manager', requiresApproval: !!b.requiresApproval, active: true, sortOrder: i,
    })),
    ...BASE_RULES.map((r, i) => ({
      key: r.key, name: r.name, category: r.category, points: r.points, pointsMax: r.pointsMax || null,
      icon: r.icon || '', color: r.color || '', description: r.desc || '', frequency: r.frequency || 'unlimited',
      approvalLevel: r.approvalLevel || 'auto', requiresApproval: !!r.requiresApproval, active: r.active !== false, sortOrder: 100 + i,
    })),
  ];
  for (const row of rows) {
    const [, made] = await RewardRule.findOrCreate({ where: { key: row.key }, defaults: row });
    if (made) created++;
  }
  if (created) console.log(`[reward-seed] created ${created} reward rule(s)`);

  // Seed a starter reward-store catalogue (idempotent by name).
  const STORE = [
    { name: 'Amazon Voucher ₹250', vendor: 'Amazon', category: 'voucher', icon: '🛒', cost: 500, rupeeValue: 250 },
    { name: 'Amazon Voucher ₹500', vendor: 'Amazon', category: 'voucher', icon: '🛒', cost: 1000, rupeeValue: 500 },
    { name: 'Amazon Voucher ₹1000', vendor: 'Amazon', category: 'voucher', icon: '🛒', cost: 2000, rupeeValue: 1000 },
    { name: 'Swiggy Voucher ₹500', vendor: 'Swiggy', category: 'food', icon: '🍔', cost: 1000, rupeeValue: 500 },
    { name: 'Zomato Voucher ₹500', vendor: 'Zomato', category: 'food', icon: '🍕', cost: 1000, rupeeValue: 500 },
    { name: 'Zomato Voucher ₹1000', vendor: 'Zomato', category: 'food', icon: '🍕', cost: 2000, rupeeValue: 1000 },
    { name: 'Team Lunch', vendor: 'Company', category: 'perk', icon: '🍽️', cost: 2500, rupeeValue: 0, description: 'A sponsored lunch with your team.' },
    { name: 'Half-day Off', vendor: 'Company', category: 'perk', icon: '🏖️', cost: 3000, rupeeValue: 0, description: 'Redeem for a half-day of paid time off (HR approval).' },
  ];
  let storeCreated = 0;
  for (let i = 0; i < STORE.length; i++) {
    const s = STORE[i];
    const [, made] = await RewardCatalogueItem.findOrCreate({ where: { name: s.name }, defaults: { ...s, sortOrder: i, active: true } });
    if (made) storeCreated++;
  }
  if (storeCreated) console.log(`[reward-seed] created ${storeCreated} store item(s)`);
  return created;
}

module.exports = { seed, BADGES, BASE_RULES };
