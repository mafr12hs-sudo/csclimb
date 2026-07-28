# CareerOS — Phase 3/4 Supabase Backend

## What's in here

```
schema.sql              — full normalized/JSONB-hybrid schema + RLS, run first
storage-buckets.sql      — 6 private buckets + owner-only RLS, run second
js/
  supabaseClient.js      — single client instance (put your project URL/key here)
  auth.js                — signup/login/logout/reset/session listener
  database.js             — all CRUD, UI never calls supabase.from() directly
  storage.js              — file uploads (recordings, portfolio evidence, docs)
  sync.js                  — offline queue + local cache + reconnect handling
  learningEngine.js        — readiness score math, ported 1:1 from your existing calc*() functions
  ai.js                    — client-side AI calls, routed through the edge function
  migrateLocalData.js      — one-time career_os_v1 → Supabase import
  appShell.js               — boot sequence: auth gate → migrate → render
edge-functions/
  ai-proxy/index.ts         — holds your Anthropic key server-side; deploy this
```

## Setup, in order

1. **Create a Supabase project.** Copy the URL and anon key into `js/supabaseClient.js`.
2. **Run `schema.sql`** in the Supabase SQL editor, then **`storage-buckets.sql`**.
3. **Deploy the edge function:**
   ```
   supabase functions deploy ai-proxy
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
4. **Enable email auth** in Supabase Auth settings (it's on by default). Add password reset redirect URLs for your domain.
5. Drop the `js/` folder next to `index__11_.html`, add `<script type="module" src="js/appShell.js"></script>` before `</body>`, and build a minimal login/signup screen that calls `window.careerosAuth.signIn(email, pw)` etc. — see the contract at the top of `appShell.js`.

## Where I deviated from the spec you pasted, and why

**Not fully normalized.** The spec asks for ~20 relational tables. Your actual data today is one JSON blob (`career_os_v1`) with a handful of genuinely list-like collections inside it. I normalized the parts that will actually be queried/filtered/sorted as rows (portfolio, applications, star answers, practice log, boss battles, etc.) and kept small per-user singletons (skills, goals, salary notes, streaks) as JSONB columns. This makes the migration a near-direct copy instead of a data-modeling exercise, and you lose nothing — any JSONB column can be split into its own table later without touching the rest of the schema. Full normalization now, before a second course exists, is exactly the kind of "rewrite everything later" risk the brief was trying to avoid.

**AI calls now go through a server-side proxy, not the browser.** Your current `callClaude()` hits `api.anthropic.com` with no API key — it only works because Claude.ai's artifact runtime proxies it. That silently breaks the moment this is a real, standalone site. `ai.js` + `edge-functions/ai-proxy` fix that: the key lives in Supabase's secrets, never in client code.

**Multi-course readiness, done narrowly.** `courses` → `learning_paths` → `modules` → `lessons` is in place and seeded with your current Customer Success modules. Adding Sales/Product/English/Leadership later is inserting rows, not schema changes.

## What's genuinely still left — and why I didn't do it blind

The one thing I did **not** do is rewrite the UI code in `index__11_.html` to call `database.js`/`sync.js` instead of `STATE`/`saveState()`. That's ~5,500 lines of working UI, and the honest way to do that refactor is section by section, running the app after each change to confirm nothing broke — not generating it in one pass with no way to test it. Doing it blind risks exactly the regression the brief says not to cause.

That part is a better fit for **Claude Code**, where I can edit `index__11_.html` directly, run it, and verify each section (auth screen → daily mission → modules → portfolio → interview prep → boss battles) before moving to the next, with this backend already in place to wire against.

## Still open, worth deciding before the UI refactor starts

- **Lesson-level granularity**: your current `modules` array only tracks a `completed` count per module, not per-lesson state. `lesson_progress` in the schema assumes real lesson rows. Either backfill actual lesson rows per module (best long-term) or keep a `completed_count` column on `modules` as an interim measure — worth deciding before wiring the UI, since it changes how "mark lesson complete" behaves.
- **Conflict resolution is last-write-wins**, appropriate for one user on one device at a time. If people will genuinely use this across two devices simultaneously, that needs a real merge strategy, not just a queue.
