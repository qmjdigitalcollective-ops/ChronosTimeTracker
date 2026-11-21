-- A hour limit shared by the whole team on one client, over repeating periods.
-- Example: Entry Level = 80 hours per 14 days, counted across everyone, starting Mon 2026-11-16.
-- The weekly limit on a contract (per person) is unchanged and still applies on top.
alter table public.clients
  add column if not exists period_limit_hours numeric,
  add column if not exists period_start date,
  add column if not exists period_days integer default 14;

update public.clients
   set period_limit_hours = 80, period_start = date '2026-11-16', period_days = 14
 where id = 'entry-level';
