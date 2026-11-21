-- GMBmirror: read-only checks after applying supabase/migrations/20261121000000_gmbmirror_core.sql.
-- Run with psql (it prints every result):  psql "$SESSION_POOLER_URL" -v ON_ERROR_STOP=1 -f supabase/verify/verify_schema.sql
-- Every check returns one row per item with ok = true/false. The behaviour checks create two temporary users inside a
-- transaction that is ROLLED BACK at the end, so the database is left exactly as it was (no test records remain).

\echo '== 1. Tables exist and Row Level Security is on'
select t.name as table_name, c.oid is not null as exists, coalesce(c.relrowsecurity, false) as rls_on
from (values ('accounts'), ('locations'), ('location_records'), ('google_connections'), ('user_records'), ('jobs'), ('rate_limits'), ('migration_runs')) t(name)
left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by 1;

\echo '== 2. Foreign keys'
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace order by 1, 2;

\echo '== 3. Indexes'
select tablename, indexname from pg_indexes where schemaname = 'public'
  and tablename in ('accounts', 'locations', 'location_records', 'google_connections', 'user_records', 'jobs', 'rate_limits', 'migration_runs') order by 1, 2;

\echo '== 4. Policies (read-only own rows; none on google_connections, jobs, rate_limits, migration_runs)'
select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2;
select t as table_without_policies, not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) as ok
from unnest(array['google_connections', 'jobs', 'rate_limits', 'migration_runs']) t;

\echo '== 5. Functions are not callable with the public keys'
select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_execute,
       not has_function_privilege(r.rolname, p.oid, 'execute') as ok
from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
where p.pronamespace = 'public'::regnamespace and p.proname in ('claim_next_job', 'take_rate_limit') order by 1, 2;

\echo '== 6. No application records yet (a fresh database: every count is 0)'
select 'accounts' as table_name, count(*) from public.accounts union all
select 'locations', count(*) from public.locations union all
select 'location_records', count(*) from public.location_records union all
select 'google_connections', count(*) from public.google_connections union all
select 'user_records', count(*) from public.user_records union all
select 'jobs', count(*) from public.jobs union all
select 'rate_limits', count(*) from public.rate_limits union all
select 'migration_runs', count(*) from public.migration_runs;

\echo '== 7. Behaviour with the browser roles (temporary users, rolled back)'
begin;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'verify-a@gmbmirror.invalid'), ('00000000-0000-4000-8000-00000000000b', 'verify-b@gmbmirror.invalid');
insert into public.accounts (user_id) values ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000b');
insert into public.locations (user_id, id) values ('00000000-0000-4000-8000-00000000000a', 'main'), ('00000000-0000-4000-8000-00000000000b', 'main');
insert into public.location_records (user_id, location_id, key, value) values
  ('00000000-0000-4000-8000-00000000000a', 'main', 'business', '{"name":"A"}'), ('00000000-0000-4000-8000-00000000000b', 'main', 'business', '{"name":"B"}');
insert into public.google_connections (user_id, location_id, connection) values ('00000000-0000-4000-8000-00000000000a', 'main', '{"tokens":"encrypted","connectedAt":"x"}');
-- Act as signed-in user A, the way Supabase does for a browser request.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', true);
select 'user A sees only own records' as check_name, array_agg(value->>'name') = array['A'] as ok from public.location_records;
select 'user A cannot read Google tokens' as check_name, count(*) = 0 as ok from public.google_connections;
select 'user A cannot read jobs or rate limits' as check_name, (select count(*) from public.jobs) + (select count(*) from public.rate_limits) = 0 as ok;
savepoint w;
update public.location_records set value = '{"name":"hacked"}';
select 'user A cannot update rows (0 changed)' as check_name, count(*) filter (where value->>'name' = 'hacked') = 0 as ok from public.location_records;
rollback to savepoint w;
set local role anon;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select 'signed out: nothing visible' as check_name, count(*) = 0 as ok from public.location_records;
rollback;

\echo '== 8. The temporary users are gone (expect 0)'
select count(*) as leftover_verify_users from auth.users where email like 'verify-%@gmbmirror.invalid';
