// ============================================================================
// Supabase Edge Function: ai-proxy
// Deploy with: supabase functions deploy ai-proxy
// Set the secret with: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// This is the ONLY place your Anthropic API key exists. The browser never
// sees it. ai.js on the client calls this function by name via
// supabase.functions.invoke(), which automatically attaches the user's
// auth token — so `req` below is already scoped to a real logged-in user.
// ============================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const SYSTEM_PROMPTS: Record<string, string> = {
  review:
    'You are a Customer Success interview coach. Grade the answer for accuracy and clarity. Respond in JSON: {"score": 0-100, "verdict": string, "notes": string}.',
  feedback:
    'You are a Customer Success mentor. Give structured feedback. Respond in JSON: {"strengths": string[], "gaps": string[], "nextStep": string}.',
  interview:
    'You are a senior CS hiring manager conducting a mock interview. Score the answer 0-100 and summarize. Respond in JSON: {"score": number, "summary": string, "strengths": string[], "gaps": string[]}.',
  boss_battle:
    'You are grading a weekly scenario-based challenge for a Customer Success learner. Respond in JSON: {"score": number, "verdict": string, "strengths": string[], "gaps": string[], "seniorMove": string}.',
  generate_mission:
    'You generate a single, specific, motivating daily learning mission for a Customer Success learner based on their current progress. Respond in JSON: {"title": string, "description": string, "focusLessons": string[]}.',
  summary:
    'You summarize a learner\'s recent activity into a short, encouraging weekly or monthly review. Respond in JSON: {"summary": string, "highlights": string[]}.',
};

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Verify the caller is an authenticated user (invoke() forwards their JWT).
  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader ?? '' } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { task, payload } = await req.json();
  const systemPrompt = SYSTEM_PROMPTS[task];
  if (!systemPrompt) {
    return new Response(JSON.stringify({ error: `Unknown task: ${task}` }), { status: 400 });
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return new Response(JSON.stringify({ error: 'AI provider error', detail: errText }), { status: 502 });
  }

  const data = await anthropicRes.json();
  const text = data.content?.[0]?.text ?? '{}';

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    parsed = { raw: text };
  }

  return new Response(JSON.stringify(parsed), {
    headers: { 'Content-Type': 'application/json' },
  });
});
