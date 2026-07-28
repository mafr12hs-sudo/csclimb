// ============================================================================
// appShell.js
// The entry point. Replaces the current pattern of "STATE = loadState()"
// running immediately at script load. Import this LAST in index.html,
// after the existing app code has defined its render functions, and call
// boot() instead of whatever currently kicks off first render.
//
// Contract with the existing app:
//   - window.renderApp()   — your existing function that draws the UI once
//                             data is ready. Not created here; must already
//                             exist in index.html.
//   - window.showAuthScreen(mode) — you'll add a minimal login/signup view;
//                             this file calls it when there's no session.
//   - window.showLoadingScreen(bool) — toggle a full-screen spinner.
// None of these three require changing existing layout/CSS — they're thin
// hooks around what's already there.
// ============================================================================
import { initAuth, onAuthChange, getUser, signIn, signUp, signOut, sendPasswordReset } from './auth.js';
import { migrateIfNeeded } from './migrateLocalData.js';
import { registerApplier, flushQueue } from './sync.js';
import * as db from './database.js';

// Wire the offline queue's declarative operation types to real database.js
// calls. Add an entry here for every table the UI writes to via
// sync.writeThrough({ type: '<name>', ... }).
function registerSyncAppliers() {
  registerApplier('update_portfolio_item', ({ id, patch }) => db.updatePortfolioItem(id, patch));
  registerApplier('save_skills', ({ courseId, scores }) => db.saveSkills(courseId, scores));
  registerApplier('create_note', (row) => db.createNote(row));
  registerApplier('create_application', (row) => db.createApplication(row));
  registerApplier('create_star_answer', (row) => db.createStarAnswer(row));
  registerApplier('create_calendar_event', (row) => db.createCalendarEvent(row));
  registerApplier('create_study_hours', (row) => db.createStudyHours(row));
  registerApplier('upsert_checkin', (row) => db.upsertDailyCheckin(row));
  registerApplier('save_goals', (patch) => db.goalsStore.save(patch));
  registerApplier('save_salary_notes', (patch) => db.salaryNotesStore.save(patch));
  registerApplier('save_streaks', (patch) => db.streaksStore.save(patch));
  // Extend as each section of the UI is migrated off direct STATE/saveState().
}

let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;

  registerSyncAppliers();
  window.showLoadingScreen?.(true);

  onAuthChange(async (session) => {
    if (!session) {
      window.showLoadingScreen?.(false);
      window.showAuthScreen?.('login');
      return;
    }

    window.showLoadingScreen?.(true);
    try {
      await migrateIfNeeded();
    } catch (err) {
      // Migration failures never block app entry — local data stays intact
      // for retry, and the app opens against whatever's already synced.
      console.error('appShell: migration check failed', err);
    }

    flushQueue();
    window.showLoadingScreen?.(false);
    window.renderApp?.();
  });

  await initAuth();
}

// --- Thin wrappers the auth screen's buttons can call directly ------------
window.careerosAuth = {
  signIn: async (email, password) => {
    try {
      await signIn(email, password);
    } catch (err) {
      window.showAuthError?.(err.message);
    }
  },
  signUp: async (email, password) => {
    try {
      await signUp(email, password);
      window.showAuthMessage?.('Check your email to confirm your account.');
    } catch (err) {
      window.showAuthError?.(err.message);
    }
  },
  signOut: async () => {
    await signOut();
  },
  forgotPassword: async (email) => {
    try {
      await sendPasswordReset(email, window.location.origin);
      window.showAuthMessage?.('Password reset email sent.');
    } catch (err) {
      window.showAuthError?.(err.message);
    }
  },
};

boot();
