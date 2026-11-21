-- TEST ONLY. The parts of a Supabase database that the GMBmirror schema relies on, for a plain local PostgreSQL:
-- the auth schema with auth.users and auth.uid(), and the anon and authenticated roles. Never run this on Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique);
-- Supabase reads the signed-in user's id from the request's JWT claims; tests set it with set_config.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase grants table privileges to these roles by default; Row Level Security then decides.
alter default privileges in schema public grant all on tables to anon, authenticated;
