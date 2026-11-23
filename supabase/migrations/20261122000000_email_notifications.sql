-- GMBmirror: email notifications (preferences and a per-user log of what was sent).
-- check: select coalesce((select pg_get_constraintdef(oid) like '%email_log%' from pg_constraint where conname = 'user_records_key_check' and conrelid = to_regclass('public.user_records')), false)
-- Adds two kinds of per-user record. Safe to run again; changes no data and drops nothing but the old check rule,
-- which is replaced in the same transaction by a wider one.

alter table public.user_records drop constraint if exists user_records_key_check;
alter table public.user_records add constraint user_records_key_check check (key in ('ai_usage', 'notifications', 'email_log'));
