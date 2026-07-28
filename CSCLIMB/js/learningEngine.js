// ============================================================================
// learningEngine.js
// Progress calculations, readiness scoring, streaks, unlocking, mission
// state. This is a direct port of the calc*() functions already in
// index__11_.html (lines ~1764-1856) — the math is unchanged, only the
// data source moves from the global `STATE` object to whatever is passed
// in (usually the current in-memory cache from sync.js).
//
// Keeping the math here unchanged is the whole point: Phase 3/4 must not
// change the learning experience, so this file is deliberately boring.
// ============================================================================

export function calcLearningCompletion(modules) {
  const total = modules.reduce((s, m) => s + m.lesson_count, 0);
  const done = modules.reduce((s, m) => s + (m.completed_lessons ?? 0), 0);
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export function calcPortfolioScore(portfolioItems) {
  if (!portfolioItems.length) return 0;
  const done = portfolioItems.filter((p) => p.done).length;
  return Math.round((done / portfolioItems.length) * 100);
}

export function calcInterviewReadiness(starAnswers, salaryNotes) {
  const stars = starAnswers.length;
  const salary = salaryNotes?.target ? 20 : 0;
  return Math.min(100, Math.round(stars * 12 + salary));
}

export function calcConsistency(studyHours) {
  if (!studyHours.length) return 0;
  const recent = studyHours.slice(-14);
  const daysStudied = new Set(recent.map((l) => l.log_date)).size;
  return Math.min(100, Math.round((daysStudied / 14) * 100));
}

export function calcApplicationsScore(applications) {
  const apps = applications.length;
  const interviews = applications.filter((a) => ['interview', 'offer'].includes(a.status)).length;
  return Math.min(100, apps * 5 + interviews * 15);
}

export function calcBrandingScore(portfolioItems) {
  const p1 = portfolioItems.find((p) => p.slug === 'p1');
  const p2 = portfolioItems.find((p) => p.slug === 'p2');
  let score = 0;
  if (p1?.done) score += 50;
  if (p2?.done) score += 50;
  return score;
}

/**
 * Full readiness score. `data` is a plain object bundling everything the
 * sub-calculations need — assemble it once per render from the cache
 * (sync.readCache()) rather than fetching each piece separately.
 *
 * data = { modules, portfolioItems, starAnswers, salaryNotes, studyHours, applications }
 */
export function calcHiringReadiness(data) {
  const components = {
    learning: { score: calcLearningCompletion(data.modules), weight: 0.25, label: 'Learning Completion' },
    portfolio: { score: calcPortfolioScore(data.portfolioItems), weight: 0.20, label: 'Portfolio Assets' },
    interview: { score: calcInterviewReadiness(data.starAnswers, data.salaryNotes), weight: 0.20, label: 'Interview Readiness' },
    consistency: { score: calcConsistency(data.studyHours), weight: 0.15, label: 'Consistency' },
    applications: { score: calcApplicationsScore(data.applications), weight: 0.10, label: 'Job Applications' },
    branding: { score: calcBrandingScore(data.portfolioItems), weight: 0.10, label: 'Professional Branding' },
  };
  const total = Object.values(components).reduce((s, c) => s + c.score * c.weight, 0);
  return { score: Math.round(total), components };
}

const ACTION_MAP = {
  learning: { text: 'Complete a module lesson', reason: 'Learning is your lowest-impact area — 25% of your score', priority: 'high', section: 'modules' },
  portfolio: { text: 'Create a portfolio asset', reason: 'Portfolio assets are the #1 signal employers check', priority: 'high', section: 'portfolio' },
  interview: { text: 'Write a STAR answer', reason: 'Interview readiness separates candidates', priority: 'high', section: 'interview' },
  consistency: { text: "Log today's study session", reason: 'Consistency shows commitment and discipline', priority: 'med', section: 'analytics' },
  applications: { text: 'Apply to a CS role', reason: 'Applications generate data and interview practice', priority: 'med', section: 'applications' },
  branding: { text: 'Complete your LinkedIn profile', reason: 'Branding is your external signal to recruiters', priority: 'high', section: 'portfolio' },
};

export function getPriorityActions(data) {
  const hr = calcHiringReadiness(data);
  const actions = [];

  const sorted = Object.entries(hr.components).sort(
    (a, b) => a[1].score * a[1].weight - b[1].score * b[1].weight
  );
  const [weakest, secondWeak] = sorted;

  if (ACTION_MAP[weakest[0]]) actions.push({ ...ACTION_MAP[weakest[0]], component: weakest[0] });
  if (ACTION_MAP[secondWeak[0]]) actions.push({ ...ACTION_MAP[secondWeak[0]], component: secondWeak[0] });

  if (hr.components.portfolio.score < 30 && !actions.find((a) => a.component === 'portfolio')) {
    actions.push(ACTION_MAP.portfolio);
  }
  if (!actions.find((a) => a.component === 'learning')) {
    actions.push(ACTION_MAP.learning);
  }

  return actions.slice(0, 3);
}

/** Streak update — call once per day the user logs activity. */
export function computeStreakUpdate(streak, todayIso) {
  const last = streak.last_log_date;
  if (last === todayIso) return streak; // already logged today, no change

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const current = last === yesterday ? streak.current_streak + 1 : 1;

  return {
    ...streak,
    current_streak: current,
    last_log_date: todayIso,
    weekly_logs: [...(streak.weekly_logs ?? []), todayIso].slice(-7),
  };
}
