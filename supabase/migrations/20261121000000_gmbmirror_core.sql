-- GMBmirror core schema (Supabase / PostgreSQL 15+).
-- Safe to run again: it creates what is missing and replaces functions and policies. It never drops data.
--
-- Access model
--   * The app reads and writes these tables only from the server, through DATABASE_URL (the Supabase connection
--     pooler). That connection is privileged and bypasses Row Level Security; every query names its user_id.
--   * Row Level Security is ON for every table. Browsers (anon and authenticated keys) can read only their own
--     non-sensitive rows and can never write. Google tokens, jobs, rate limits and migration records have no
--     policies at all, so they are unreachable with the public key.
--   * Google OAuth tokens are encrypted by the app (AES-256-GCM, TOKEN_ENCRYPTION_KEY) before they reach the
--     database; the database never holds them in plain text.

-- ---------------------------------------------------------------------------------------------------------------
-- Accounts and locations
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.accounts (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  -- The location the app shows. "main" is the first location (it keeps the original key names).
  active_location  text not null default 'main',
  -- True when the first location was removed and at least one other location remains.
  main_removed     boolean not null default false,
  -- Set only by the JSON migration script, so a migration batch can be rolled back exactly.
  migration_batch  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.locations (
  user_id     uuid not null references public.accounts (user_id) on delete cascade,
  id          text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- One JSON document per location and kind: business details, reviews and replies, posts (with schedules),
-- visibility checks, listing history (audits, rank scans, competitors), growth state, reports, automation log,
-- share counts, review statistics, profile scores, ChatGPT guide progress and notes.
create table if not exists public.location_records (
  user_id      uuid not null,
  location_id  text not null,
  key          text not null check (key in (
                 'business', 'checks', 'replies', 'posts', 'guide', 'places', 'growth', 'automation_log', 'reports',
                 'share_events', 'review_stats', 'insights_notes', 'gbp_scores')),
  value        jsonb not null,
  version      bigint not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, location_id, key),
  foreign key (user_id, location_id) references public.locations (user_id, id) on delete cascade
);

-- The Google Business Profile connection of one location. `connection.tokens` is the app-encrypted token blob.
create table if not exists public.google_connections (
  user_id       uuid not null,
  location_id   text not null,
  connection    jsonb not null,
  connected_at  text generated always as (connection ->> 'connectedAt') stored,
  version       bigint not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, location_id),
  foreign key (user_id, location_id) references public.locations (user_id, id) on delete cascade
);

-- Per-user records shared by all locations (Claude usage per month and feature).
create table if not exists public.user_records (
  user_id     uuid not null references public.accounts (user_id) on delete cascade,
  key         text not null check (key in ('ai_usage')),
  value       jsonb not null,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Background jobs: shared by every server instance
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.accounts (user_id) on delete cascade,
  -- Not a foreign key: a cancelled job stays in the history after its location is removed.
  location_id   text not null,
  kind          text not null check (kind in ('publish_post', 'review_sweep', 'refresh_profile', 'monthly_report')),
  key           text not null,
  status        text not null check (status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
  run_at        timestamptz not null,
  lease_until   timestamptz,
  -- A new random token on every claim. A runner may save its result only while it still holds this token.
  lease_token   uuid,
  attempts      integer not null default 0,
  max_attempts  integer not null default 4,
  payload       jsonb not null default '{}'::jsonb,
  last_error    text,
  -- Execution log, newest first (at most 30 entries): [{ "at", "status", "message" }].
  log           jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Duplicate protection: one live (or already succeeded) job per user and key, enforced by the database.
create unique index if not exists jobs_one_live_per_key on public.jobs (user_id, key)
  where status in ('queued', 'running', 'waiting', 'succeeded');
create index if not exists jobs_due on public.jobs (run_at) where status in ('queued', 'waiting');
create index if not exists jobs_running_lease on public.jobs (lease_until) where status = 'running';
create index if not exists jobs_by_user on public.jobs (user_id, created_at desc);
create index if not exists jobs_by_location on public.jobs (user_id, location_id);

-- Claims the next due job (time-sensitive kinds first) for one runner. SKIP LOCKED lets several runners claim at
-- the same moment without waiting for or taking each other's job. A running job whose lease has expired (its
-- runner crashed or timed out) is due again.
create or replace function public.claim_next_job(p_now timestamptz, p_lease_seconds integer)
returns setof public.jobs
language sql
as $$
  with next as (
    select id from public.jobs
    where (status in ('queued', 'waiting') and run_at <= p_now)
       or (status = 'running' and lease_until <= p_now)
    order by case kind when 'publish_post' then 0 when 'review_sweep' then 1 when 'refresh_profile' then 2 else 3 end,
             run_at
    for update skip locked
    limit 1
  )
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         lease_until = p_now + make_interval(secs => p_lease_seconds),
         lease_token = gen_random_uuid(),
         updated_at = now(),
         -- The new entry first, then the newest 29 older ones.
         log = (select coalesce(jsonb_agg(t.e order by t.n), '[]'::jsonb)
                  from jsonb_array_elements(
                         jsonb_build_array(jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                           'status', 'running', 'message', 'Attempt ' || (j.attempts + 1) || ' started.')) || j.log
                       ) with ordinality as t (e, n)
                 where t.n <= 30)
    from next
   where j.id = next.id
  returning j.*;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Rate limits shared by every server instance (login lockout, Google and Claude budgets)
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.rate_limits (
  key       text primary key,
  count     integer not null,
  reset_at  timestamptz not null
);
create index if not exists rate_limits_reset on public.rate_limits (reset_at);

-- Counts `p_cost` against a fixed window. Returns ok = false (and counts nothing) when the limit would be passed.
create or replace function public.take_rate_limit(p_key text, p_limit integer, p_window_ms integer, p_cost integer default 1)
returns table (ok boolean, retry_after_sec integer)
language plpgsql
as $$
declare
  r public.rate_limits%rowtype;
begin
  insert into public.rate_limits (key, count, reset_at) values (p_key, 0, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do nothing;
  select * into r from public.rate_limits where key = p_key for update;
  if r.reset_at <= now() then
    r.count := 0;
    r.reset_at := now() + make_interval(secs => p_window_ms / 1000.0);
  end if;
  if r.count + p_cost > p_limit then
    update public.rate_limits set count = r.count, reset_at = r.reset_at where key = p_key;
    return query select false, greatest(1, ceil(extract(epoch from (r.reset_at - now()))))::integer;
  else
    update public.rate_limits set count = r.count + p_cost, reset_at = r.reset_at where key = p_key;
    return query select true, 0;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Migration bookkeeping (JSON to Supabase)
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.migration_runs (
  batch        text primary key,
  source       text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  summary      jsonb
);

-- ---------------------------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------------------------

alter table public.accounts           enable row level security;
alter table public.locations          enable row level security;
alter table public.location_records   enable row level security;
alter table public.google_connections enable row level security;
alter table public.user_records       enable row level security;
alter table public.jobs               enable row level security;
alter table public.rate_limits        enable row level security;
alter table public.migration_runs     enable row level security;

-- Read-only access to one's own non-sensitive rows. No insert, update or delete policies: writes come only from
-- the server connection.
drop policy if exists "own account read" on public.accounts;
create policy "own account read" on public.accounts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own locations read" on public.locations;
create policy "own locations read" on public.locations for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own records read" on public.location_records;
create policy "own records read" on public.location_records for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own user records read" on public.user_records;
create policy "own user records read" on public.user_records for select to authenticated using ((select auth.uid()) = user_id);
-- google_connections, jobs, rate_limits, migration_runs: no policies (no access with the public keys).

-- The public keys never need the functions.
revoke all on function public.claim_next_job(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.take_rate_limit(text, integer, integer, integer) from public, anon, authenticated;
