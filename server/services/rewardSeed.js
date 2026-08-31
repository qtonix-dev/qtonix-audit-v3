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
  { id: 'helping_hand', name: 'Helping Hand', icon: '❤️', color: '#DB2777', points: 250, desc: 'Going out of the way to help another employee' },
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
];

async function seed(models) {
  const { RewardRule } = models;
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
  return created;
}

module.exports = { seed, BADGES, BASE_RULES };
