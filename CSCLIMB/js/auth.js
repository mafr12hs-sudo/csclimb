// ============================================================================
// auth.js
// Everything auth-related. The UI shell (see appShell.js) is the only other
// file that should touch this — no other module should import supabase.auth
// directly.
// ============================================================================
import { supabase } from './supabaseClient.js';

const listeners = new Set();
let currentSession = null;
let initialized = false;

/** Subscribe to auth state changes: cb(session | null) */
export function onAuthChange(cb) {
  listeners.add(cb);
  if (initialized) cb(currentSession); // fire immediately with current state
  return () => listeners.delete(cb);
}

function notify(session) {
  currentSession = session;
  for (const cb of listeners) cb(session);
}

/** Call once at app startup, before rendering anything. */
export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;
  initialized = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    notify(session);
  });

  notify(session);
  return session;
}

export function getSession() {
  return currentSession;
}

export function getUser() {
  return currentSession?.user ?? null;
}

export function isAuthenticated() {
  return !!currentSession?.user;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email, redirectTo) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
