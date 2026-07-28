// ============================================================================
// database.js
// The only module that runs Supabase table queries. UI components call
// these functions; they never construct a supabase.from(...) call directly.
//
// Conventions:
//   - every function takes/returns plain JS objects shaped like the current
//     STATE sub-objects, so callers barely change.
//   - "singleton" tables (one row per user: goals, salary_notes, settings,
//     streaks, skills) use getX()/saveX() pairs — saveX does an upsert.
//   - "list" tables (portfolio_items, notes, applications, ...) use
//     listX()/createX()/updateX()/deleteX().
// ============================================================================
import { supabase } from './supabaseClient.js';
import { getUser } from './auth.js';

function uid() {
  const u = getUser();
  if (!u) throw new Error('database.js: no authenticated user');
  return u.id;
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// PROFILE
// ---------------------------------------------------------------------------
export async function getProfile() {
  return unwrap(await supabase.from('profiles').select('*').eq('id', uid()).single());
}

export async function updateProfile(patch) {
  return unwrap(
    await supabase.from('profiles').update(patch).eq('id', uid()).select().single()
  );
}

// ---------------------------------------------------------------------------
// COURSES / MODULES / LESSONS (read-only catalog data for the UI)
// ---------------------------------------------------------------------------
export async function listCourses() {
  return unwrap(await supabase.from('courses').select('*').eq('is_active', true));
}

export async function getCourseModules(courseId) {
  return unwrap(
    await supabase
      .from('modules')
      .select('*, learning_paths!inner(course_id)')
      .eq('learning_paths.course_id', courseId)
      .order('sort_order')
  );
}

// ---------------------------------------------------------------------------
// LESSON PROGRESS
// ---------------------------------------------------------------------------
export async function getLessonProgress() {
  return unwrap(await supabase.from('lesson_progress').select('*').eq('user_id', uid()));
}

export async function setLessonComplete(lessonId, moduleId, completed = true) {
  return unwrap(
    await supabase.from('lesson_progress').upsert(
      {
        user_id: uid(),
        lesson_id: lessonId,
        module_id: moduleId,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,lesson_id' }
    ).select().single()
  );
}

// ---------------------------------------------------------------------------
// SKILLS (singleton per user+course)
// ---------------------------------------------------------------------------
export async function getSkills(courseId) {
  const { data, error } = await supabase
    .from('skills')
    .select('scores')
    .eq('user_id', uid())
    .eq('course_id', courseId)
    .maybeSingle();
  if (error) throw error;
  return data?.scores ?? {};
}

export async function saveSkills(courseId, scores) {
  return unwrap(
    await supabase.from('skills').upsert(
      { user_id: uid(), course_id: courseId, scores, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,course_id' }
    ).select().single()
  );
}

// ---------------------------------------------------------------------------
// PORTFOLIO
// ---------------------------------------------------------------------------
export async function listPortfolioItems() {
  return unwrap(
    await supabase.from('portfolio_items').select('*').eq('user_id', uid()).order('sort_order')
  );
}

export async function updatePortfolioItem(id, patch) {
  return unwrap(
    await supabase.from('portfolio_items').update(patch).eq('id', id).eq('user_id', uid()).select().single()
  );
}

export async function addPortfolioEvidence(portfolioItemId, { description, link, storagePath }) {
  return unwrap(
    await supabase.from('portfolio_evidence').insert({
      user_id: uid(),
      portfolio_item_id: portfolioItemId,
      description,
      link,
      storage_path: storagePath,
    }).select().single()
  );
}

// ---------------------------------------------------------------------------
// GENERIC LIST-TABLE HELPERS
// Covers: knowledge_base, applications, star_answers, calendar_events,
// energy_log, study_hours, activity_log, practice_log, answer_history,
// ai_feedback, takeaways, reflections, boss_battles, monthly_interviews,
// daily_checkins, missions.
// ---------------------------------------------------------------------------
export function listTable(table, { orderBy = 'created_at', ascending = false } = {}) {
  return async function list() {
    return unwrap(
      await supabase.from(table).select('*').eq('user_id', uid()).order(orderBy, { ascending })
    );
  };
}

export function insertRow(table) {
  return async function create(row) {
    return unwrap(
      await supabase.from(table).insert({ ...row, user_id: uid() }).select().single()
    );
  };
}

export function updateRow(table) {
  return async function update(id, patch) {
    return unwrap(
      await supabase.from(table).update(patch).eq('id', id).eq('user_id', uid()).select().single()
    );
  };
}

export function deleteRow(table) {
  return async function del(id) {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', uid());
    if (error) throw error;
  };
}

// Pre-bound convenience exports — one line per current STATE list.
export const listNotes = listTable('knowledge_base');
export const createNote = insertRow('knowledge_base');
export const updateNote = updateRow('knowledge_base');
export const deleteNote = deleteRow('knowledge_base');

export const listApplications = listTable('applications');
export const createApplication = insertRow('applications');
export const updateApplication = updateRow('applications');
export const deleteApplication = deleteRow('applications');

export const listStarAnswers = listTable('star_answers');
export const createStarAnswer = insertRow('star_answers');
export const updateStarAnswer = updateRow('star_answers');
export const deleteStarAnswer = deleteRow('star_answers');

export const listCalendarEvents = listTable('calendar_events', { orderBy: 'event_date', ascending: true });
export const createCalendarEvent = insertRow('calendar_events');
export const deleteCalendarEvent = deleteRow('calendar_events');

export const listEnergyLog = listTable('energy_log', { orderBy: 'log_date', ascending: false });
export const createEnergyLog = insertRow('energy_log');

export const listStudyHours = listTable('study_hours', { orderBy: 'log_date', ascending: false });
export const createStudyHours = insertRow('study_hours');

export const listActivityLog = listTable('activity_log');
export const createActivityLog = insertRow('activity_log');

export const listPracticeLog = listTable('practice_log');
export const createPracticeLog = insertRow('practice_log');

export const listAnswerHistory = listTable('answer_history');
export const createAnswerHistory = insertRow('answer_history');

export const listAiFeedback = listTable('ai_feedback');
export const createAiFeedback = insertRow('ai_feedback');

export const listTakeaways = listTable('takeaways');
export const createTakeaway = insertRow('takeaways');

export const listBossBattles = listTable('boss_battles', { orderBy: 'week_number', ascending: false });
export const createBossBattle = insertRow('boss_battles');

export const listMonthlyInterviews = listTable('monthly_interviews');
export const createMonthlyInterview = insertRow('monthly_interviews');

export const listDailyCheckins = listTable('daily_checkins', { orderBy: 'checkin_date', ascending: false });
export const upsertDailyCheckin = async (row) =>
  unwrap(
    await supabase
      .from('daily_checkins')
      .upsert({ ...row, user_id: uid() }, { onConflict: 'user_id,checkin_date' })
      .select()
      .single()
  );

// ---------------------------------------------------------------------------
// SINGLETON TABLES: goals, salary_notes, settings, streaks
// ---------------------------------------------------------------------------
function singleton(table) {
  return {
    async get() {
      const { data, error } = await supabase.from(table).select('*').eq('user_id', uid()).maybeSingle();
      if (error) throw error;
      return data;
    },
    async save(patch) {
      return unwrap(
        await supabase
          .from(table)
          .upsert({ user_id: uid(), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
          .select()
          .single()
      );
    },
  };
}

export const goalsStore = singleton('goals');
export const salaryNotesStore = singleton('salary_notes');
export const settingsStore = singleton('settings');
export const streaksStore = singleton('streaks');
