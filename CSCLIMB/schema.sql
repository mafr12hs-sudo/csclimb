-- ============================================================================
-- CareerOS — Supabase Schema (Phase 3)
-- ============================================================================
-- Design notes (read before running):
--
-- 1. NORMALIZED where it earns its keep — courses/learning_paths/modules,
--    because "you'll have multiple courses tomorrow" is a real, near-term
--    requirement and getting this wrong now means a painful migration later.
--
-- 2. JSONB where the current data is genuinely document-shaped and doesn't
--    benefit from being split into rows today — skills (a fixed small map),
--    salary_notes, goals, consistency. Splitting these into 4-5 more tables
--    right now buys you nothing (you don't query across users' individual
--    skill scores) and doubles the migration + service-layer surface area.
--    You can normalize any of these later without touching the others —
--    that's the point of the service-layer boundary in database.js.
--
-- 3. Tables that WILL benefit from being rows now, because you already
--    query/filter/sort them as lists: portfolio_items, notes, applications,
--    star_answers, calendar_events, practice_log, boss_battles,
--    monthly_interviews, daily_checkins, study_hours, activity_log.
--
-- Every table has RLS enabled and scoped to auth.uid(). Run top to bottom
-- in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- PROFILES
-- One row per authenticated user. Created by trigger on auth.users insert.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  active_course_id uuid,               -- set after courses table exists (fk added below)
  onboarded boolean not null default false,
  local_migration_completed_at timestamptz,  -- set once localStorage import succeeds
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- COURSES / LEARNING PATHS / MODULES
-- Multi-course ready: Customer Success today, Sales/Product/English/
-- Leadership later, without touching this schema again.
-- ----------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                 -- e.g. 'customer-success'
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.learning_paths (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  slug text not null,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (course_id, slug)
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  learning_path_id uuid not null references public.learning_paths(id) on delete cascade,
  slug text not null,                  -- stable id, e.g. 'm1' from current app
  name text not null,
  lesson_count int not null default 0, -- denormalized total, mirrors current app's `lessons`
  weight int not null default 0,       -- readiness-score weighting
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (learning_path_id, slug)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  slug text not null,
  title text not null,
  sort_order int not null default 0,
  content jsonb not null default '{}'::jsonb,  -- lesson body, exercises, etc.
  created_at timestamptz not null default now(),
  unique (module_id, slug)
);

alter table public.profiles
  add constraint profiles_active_course_fk
  foreign key (active_course_id) references public.courses(id) on delete set null;

-- ----------------------------------------------------------------------------
-- PER-USER, PER-COURSE PROGRESS
-- ----------------------------------------------------------------------------
create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

-- Module completion count is derived from lesson_progress; expose via view
-- rather than storing a duplicate counter that can drift.
create view public.module_completion as
  select
    lp.user_id,
    m.id as module_id,
    m.learning_path_id,
    count(*) filter (where lp.completed) as completed_lessons,
    m.lesson_count
  from public.modules m
  left join public.lesson_progress lp on lp.module_id = m.id
  group by lp.user_id, m.id, m.learning_path_id, m.lesson_count;

-- ----------------------------------------------------------------------------
-- SKILLS — kept as JSONB (a fixed ~11-key map per user per course today).
-- skill_evidence is genuinely list-like (links/notes attached to a skill)
-- so it gets its own table.
-- ----------------------------------------------------------------------------
create table public.skills (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,   -- { "Communication": 78, ... }
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table public.skill_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_key text not null,
  description text,
  link text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- PORTFOLIO
-- ----------------------------------------------------------------------------
create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  slug text,                            -- stable id like 'p1' for seed items
  name text not null,
  description text,
  done boolean not null default false,
  impact text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portfolio_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_item_id uuid not null references public.portfolio_items(id) on delete cascade,
  description text,
  link text,
  storage_path text,                    -- points into 'portfolio-evidence' bucket
  saved_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- KNOWLEDGE BASE / NOTES
-- ----------------------------------------------------------------------------
create table public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- JOB APPLICATIONS
-- ----------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text not null,
  role text,
  status text not null default 'applied', -- applied | interview | offer | rejected | withdrawn
  applied_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- STAR ANSWERS (interview prep)
-- ----------------------------------------------------------------------------
create table public.star_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text,
  situation text,
  task text,
  action text,
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- CALENDAR / ENERGY / STUDY LOGS
-- ----------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  event_date date not null,
  event_time time,
  notes text,
  created_at timestamptz not null default now()
);

create table public.energy_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  energy_level int,
  notes text,
  created_at timestamptz not null default now()
);

create table public.study_hours (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  minutes int not null default 0,
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- GOALS / VISION / SALARY / SETTINGS — small per-user singletons, JSONB.
-- ----------------------------------------------------------------------------
create table public.goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  short jsonb not null default '[]'::jsonb,
  mid jsonb not null default '[]'::jsonb,
  long jsonb not null default '[]'::jsonb,
  vision_statement text default '',
  updated_at timestamptz not null default now()
);

create table public.salary_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target text,
  minimum text,
  notes text,
  points text,
  updated_at timestamptz not null default now()
);

create table public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- CONSISTENCY / STREAKS
-- ----------------------------------------------------------------------------
create table public.streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak int not null default 0,
  last_log_date date,
  weekly_logs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- DAILY MISSIONS / CHECK-INS
-- ----------------------------------------------------------------------------
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_date date not null,
  focus_lessons jsonb not null default '[]'::jsonb,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, mission_date)
);

create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  feeling text,
  time_available text,
  goal text,
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

-- ----------------------------------------------------------------------------
-- PRACTICE LOG / RECORDINGS / ANSWER HISTORY / TAKEAWAYS / AI FEEDBACK
-- ----------------------------------------------------------------------------
create table public.practice_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_type text not null,             -- 'validation' | 'reflection' | etc.
  skill_key text,
  skill_label text,
  preview text,
  has_audio boolean not null default false,
  storage_path text,                    -- audio in 'interview-recordings' bucket
  created_at timestamptz not null default now()
);

create table public.answer_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_key text not null,
  entry_type text not null,             -- 'validation' | 'reflection'
  text text,
  created_at timestamptz not null default now()
);

create table public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_key text not null,
  feedback_type text not null,          -- 'validation' | 'reflection'
  feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.takeaways (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_key text not null,
  takeaway text,
  created_at timestamptz not null default now()
);

create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  body text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- BOSS BATTLES (weekly) / INTERVIEWS (monthly) / REVIEWS
-- ----------------------------------------------------------------------------
create table public.boss_battles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_number int not null,
  battle_id text,
  title text,
  response text,
  score int,
  verdict text,
  strengths jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  senior_move text,
  created_at timestamptz not null default now()
);

create table public.monthly_interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,              -- e.g. '2026-07'
  question text,
  answer text,
  score int,
  summary text,
  strengths jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  has_audio boolean not null default false,
  storage_path text,
  created_at timestamptz not null default now()
);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, month_key)
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.learning_paths enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.skills enable row level security;
alter table public.skill_evidence enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.portfolio_evidence enable row level security;
alter table public.knowledge_base enable row level security;
alter table public.applications enable row level security;
alter table public.star_answers enable row level security;
alter table public.calendar_events enable row level security;
alter table public.energy_log enable row level security;
alter table public.study_hours enable row level security;
alter table public.activity_log enable row level security;
alter table public.goals enable row level security;
alter table public.salary_notes enable row level security;
alter table public.settings enable row level security;
alter table public.streaks enable row level security;
alter table public.missions enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.practice_log enable row level security;
alter table public.answer_history enable row level security;
alter table public.ai_feedback enable row level security;
alter table public.takeaways enable row level security;
alter table public.reflections enable row level security;
alter table public.boss_battles enable row level security;
alter table public.monthly_interviews enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.monthly_reviews enable row level security;

-- courses / learning_paths / modules / lessons are shared catalog data:
-- readable by any authenticated user, writable only by service role (you,
-- via the dashboard or an admin script) — not by end users.
create policy "courses readable by authenticated" on public.courses
  for select using (auth.role() = 'authenticated');
create policy "learning_paths readable by authenticated" on public.learning_paths
  for select using (auth.role() = 'authenticated');
create policy "modules readable by authenticated" on public.modules
  for select using (auth.role() = 'authenticated');
create policy "lessons readable by authenticated" on public.lessons
  for select using (auth.role() = 'authenticated');

-- profiles: user can read/update only their own row.
create policy "profiles self select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles self insert" on public.profiles
  for insert with check (auth.uid() = id);

-- Generic pattern applied to every remaining user-owned table:
-- select/insert/update/delete only where user_id = auth.uid().
-- (lesson_progress uses the same pattern.)
do $$
declare
  t text;
  owned_tables text[] := array[
    'lesson_progress','skills','skill_evidence','portfolio_items',
    'portfolio_evidence','knowledge_base','applications','star_answers',
    'calendar_events','energy_log','study_hours','activity_log','goals',
    'salary_notes','settings','streaks','missions','daily_checkins',
    'practice_log','answer_history','ai_feedback','takeaways','reflections',
    'boss_battles','monthly_interviews','weekly_reviews','monthly_reviews'
  ];
begin
  foreach t in array owned_tables loop
    execute format(
      'create policy "%1$s owner select" on public.%1$s for select using (auth.uid() = user_id);', t);
    execute format(
      'create policy "%1$s owner insert" on public.%1$s for insert with check (auth.uid() = user_id);', t);
    execute format(
      'create policy "%1$s owner update" on public.%1$s for update using (auth.uid() = user_id);', t);
    execute format(
      'create policy "%1$s owner delete" on public.%1$s for delete using (auth.uid() = user_id);', t);
  end loop;
end $$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Create a profile row automatically when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  insert into public.goals (user_id) values (new.id);
  insert into public.salary_notes (user_id) values (new.id);
  insert into public.settings (user_id) values (new.id);
  insert into public.streaks (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Generic updated_at bumper, attached where the column exists.
create or replace function public.bump_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.bump_updated_at();
create trigger trg_lesson_progress_updated before update on public.lesson_progress
  for each row execute function public.bump_updated_at();
create trigger trg_portfolio_items_updated before update on public.portfolio_items
  for each row execute function public.bump_updated_at();
create trigger trg_knowledge_base_updated before update on public.knowledge_base
  for each row execute function public.bump_updated_at();
create trigger trg_applications_updated before update on public.applications
  for each row execute function public.bump_updated_at();
create trigger trg_star_answers_updated before update on public.star_answers
  for each row execute function public.bump_updated_at();
create trigger trg_goals_updated before update on public.goals
  for each row execute function public.bump_updated_at();
create trigger trg_salary_notes_updated before update on public.salary_notes
  for each row execute function public.bump_updated_at();
create trigger trg_settings_updated before update on public.settings
  for each row execute function public.bump_updated_at();
create trigger trg_streaks_updated before update on public.streaks
  for each row execute function public.bump_updated_at();
create trigger trg_skills_updated before update on public.skills
  for each row execute function public.bump_updated_at();

-- ============================================================================
-- SEED: the Customer Success course, matching current DEFAULT_STATE.modules
-- ============================================================================
insert into public.courses (slug, name, description) values
  ('customer-success', 'Customer Success', 'International CS career tracker')
on conflict (slug) do nothing;

insert into public.learning_paths (course_id, slug, name, sort_order)
select id, 'core', 'Core Path', 0 from public.courses where slug = 'customer-success'
on conflict (course_id, slug) do nothing;

insert into public.modules (learning_path_id, slug, name, lesson_count, weight, sort_order)
select lp.id, m.slug, m.name, m.lesson_count, m.weight, m.sort_order
from public.learning_paths lp
cross join (values
  ('m1','Customer Success Foundations',12,15,0),
  ('m2','SaaS Ecosystem',10,12,1),
  ('m3','CRM Systems & HubSpot',8,12,2),
  ('m4','Communication Mastery',6,10,3),
  ('m5','Business Fundamentals',8,10,4),
  ('m6','Technical Fundamentals',6,8,5),
  ('m7','AI & Automation for CS',6,8,6),
  ('m8','Customer Retention & Churn',8,12,7),
  ('m9','Metrics & Analytics',6,8,8),
  ('m10','Enterprise Communication',5,7,9),
  ('m11','Interview Preparation',6,8,10)
) as m(slug, name, lesson_count, weight, sort_order)
where lp.slug = 'core'
on conflict (learning_path_id, slug) do nothing;
