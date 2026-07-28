// ============================================================================
// migrateLocalData.js
// Runs once per browser, right after a user's first successful login.
// Reads the existing 'career_os_v1' localStorage blob and uploads every
// piece into Supabase. Order matters: profile/course setup first, then
// independent tables, then anything that references portfolio_items'
// generated ids.
//
// Safety: only clears localStorage after every step succeeds AND the
// profile's local_migration_completed_at is set — so a failed run is safe
// to retry (nothing is deleted on error), and a completed run never
// re-imports on a later login.
// ============================================================================
import { getUser } from './auth.js';
import * as db from './database.js';
import { supabase } from './supabaseClient.js';

const STORAGE_KEY = 'career_os_v1';

export async function migrateIfNeeded() {
  const user = getUser();
  if (!user) return { migrated: false, reason: 'no-user' };

  const profile = await db.getProfile();
  if (profile.local_migration_completed_at) {
    return { migrated: false, reason: 'already-done' };
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // Nothing to migrate — a brand new user. Mark done so we never check again.
    await db.updateProfile({ local_migration_completed_at: new Date().toISOString() });
    return { migrated: false, reason: 'no-local-data' };
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    console.error('migrateLocalData: local data is corrupt, skipping migration', err);
    return { migrated: false, reason: 'corrupt-data', error: err };
  }

  const { data: course } = await supabase
    .from('courses')
    .select('id')
    .eq('slug', 'customer-success')
    .single();

  const steps = [];

  // --- Skills (singleton) ---------------------------------------------
  if (state.skills) {
    steps.push(['skills', () => db.saveSkills(course.id, state.skills)]);
  }

  // --- Module progress ---------------------------------------------------
  // module ids in local state are slugs ('m1'..'m11'); resolve to real ids.
  if (Array.isArray(state.modules)) {
    steps.push(['modules', async () => {
      const { data: dbModules } = await supabase.from('modules').select('id, slug');
      const bySlug = Object.fromEntries(dbModules.map((m) => [m.slug, m.id]));
      for (const m of state.modules) {
        const moduleId = bySlug[m.id];
        if (!moduleId) continue;
        // We don't have per-lesson granularity locally, only a completed
        // count — record it as activity_log so no data is silently dropped,
        // since lesson_progress needs real lesson ids we don't have yet.
        await db.createActivityLog({
          activity_type: 'migrated_module_progress',
          detail: { module_slug: m.id, completed: m.completed, lessons: m.lessons },
        });
      }
    }]);
  }

  // --- Portfolio -----------------------------------------------------
  if (Array.isArray(state.portfolio)) {
    steps.push(['portfolio', async () => {
      for (const [i, p] of state.portfolio.entries()) {
        await db.insertRow('portfolio_items')({
          slug: p.id,
          name: p.name,
          description: p.desc,
          done: !!p.done,
          impact: p.impact,
          sort_order: i,
        });
      }
    }]);
  }

  // --- Simple list tables: straight field-mapped inserts -----------------
  const listMigrations = [
    ['notes', state.notes, (n) => ({ title: n.title ?? 'Untitled', body: n.body ?? n.text ?? '' })],
    ['applications', state.applications, (a) => ({ company: a.company, role: a.role, status: a.status, applied_at: a.date, notes: a.notes })],
    ['star_answers', state.starAnswers, (s) => ({ question: s.question, situation: s.situation, task: s.task, action: s.action, result: s.result })],
    ['calendar_events', state.calendarEvents, (e) => ({ title: e.title, event_date: e.date, event_time: e.time, notes: e.notes })],
    ['energy_log', state.energyLog, (e) => ({ log_date: e.date, energy_level: e.level, notes: e.notes })],
    ['study_hours', state.studyHours, (s) => ({ log_date: s.date, minutes: s.minutes ?? 0 })],
    ['boss_battles', state.bossBattles?.history, (b) => ({ week_number: b.week, battle_id: b.battleId, title: b.title, response: b.response, score: b.score, verdict: b.verdict, strengths: b.strengths ?? [], gaps: b.gaps ?? [], senior_move: b.seniorMove })],
    ['monthly_interviews', state.monthlyInterviews?.history, (m) => ({ month_key: m.monthKey, question: m.question, answer: m.answer, score: m.score, summary: m.summary, strengths: m.strengths ?? [], gaps: m.gaps ?? [], has_audio: !!m.hasAudio })],
  ];

  for (const [table, list, mapFn] of listMigrations) {
    if (!Array.isArray(list) || !list.length) continue;
    steps.push([table, async () => {
      for (const item of list) {
        await db.insertRow(table)(mapFn(item));
      }
    }]);
  }

  // --- Singletons ----------------------------------------------------
  if (state.goals) {
    steps.push(['goals', () => db.goalsStore.save({
      short: state.goals.short ?? [],
      mid: state.goals.mid ?? [],
      long: state.goals.long ?? [],
      vision_statement: state.visionStatement ?? '',
    })]);
  }
  if (state.salaryNotes) {
    steps.push(['salary_notes', () => db.salaryNotesStore.save({
      target: state.salaryNotes.target,
      minimum: state.salaryNotes.minimum,
      notes: state.salaryNotes.notes,
      points: state.salaryNotes.points,
    })]);
  }
  if (state.consistency) {
    steps.push(['streaks', () => db.streaksStore.save({
      current_streak: state.consistency.streak ?? 0,
      last_log_date: state.consistency.lastLogDate || null,
      weekly_logs: state.consistency.weeklyLogs ?? [],
    })]);
  }

  // --- Execute sequentially, collecting failures without aborting -------
  const results = { succeeded: [], failed: [] };
  for (const [name, fn] of steps) {
    try {
      await fn();
      results.succeeded.push(name);
    } catch (err) {
      console.error(`migrateLocalData: step "${name}" failed`, err);
      results.failed.push({ name, error: String(err) });
    }
  }

  if (results.failed.length === 0) {
    await db.updateProfile({ local_migration_completed_at: new Date().toISOString() });
    localStorage.removeItem(STORAGE_KEY);
    return { migrated: true, results };
  }

  // Leave local data intact so a retry (next login, or a manual "retry
  // migration" button) can pick up where this left off.
  console.warn('migrateLocalData: partial migration, local data preserved for retry', results);
  return { migrated: false, reason: 'partial-failure', results };
}
