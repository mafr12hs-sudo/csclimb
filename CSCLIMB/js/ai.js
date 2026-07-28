// ============================================================================
// ai.js
// Every AI interaction in the app goes through this file, and this file
// only ever calls the `ai-proxy` Supabase Edge Function — never
// api.anthropic.com directly.
//
// WHY THIS CHANGED FROM THE CURRENT CODE:
// index__11_.html currently calls api.anthropic.com straight from the
// browser with no API key (see callClaude(), ~line 1914). That only works
// inside a Claude.ai artifact, which proxies the call for you. As a
// standalone SaaS app it will simply fail — and even if you added a key
// client-side, anyone could read it out of the page source and run up your
// bill. The key has to live server-side. See edge-functions/ai-proxy/
// for the function this module calls.
//
// If you later switch model providers, this is the ONLY file (plus the
// edge function) that needs to change — nothing else in the app should
// know what "Claude" or "Anthropic" even means.
// ============================================================================
import { supabase } from './supabaseClient.js';

async function callAI(task, payload) {
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { task, payload },
  });
  if (error) throw error;
  return data;
}

/** Grades a validation/reflection answer against a skill. */
export function reviewAnswer({ skillKey, skillLabel, question, answer }) {
  return callAI('review', { skillKey, skillLabel, question, answer });
}

/** Structured feedback (strengths/gaps) for a practice submission. */
export function getFeedback({ skillKey, submissionText }) {
  return callAI('feedback', { skillKey, submissionText });
}

/** Scores + summarizes a monthly mock interview answer. */
export function scoreInterview({ question, answer, hasAudio }) {
  return callAI('interview', { question, answer, hasAudio });
}

/** Scores a weekly boss battle response. */
export function scoreBossBattle({ battleId, title, response }) {
  return callAI('boss_battle', { battleId, title, response });
}

/** Generates the next daily mission given current progress snapshot. */
export function generateMission(progressSnapshot) {
  return callAI('generate_mission', progressSnapshot);
}

/** Free-form summary (weekly/monthly reviews). */
export function summarize(context) {
  return callAI('summary', context);
}
