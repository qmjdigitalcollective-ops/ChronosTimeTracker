-- Protect finished time entries from being re-opened by a late "still active" save.
-- Background: a heartbeat save that lands just after a clock-out used to put the entry
-- back to Active with no end time (KC, Oct 19 and Nov 14). The app's writes go through
-- the gate Edge Function (service_role), so this applies to service_role / anon /
-- authenticated. Direct SQL (SQL editor / CLI) is NOT affected, so an admin can still
-- reopen an entry on purpose.
create or replace function public.protect_completed_time_entry()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'completed'
     and new.status is distinct from 'completed'
     and current_user in ('service_role', 'anon', 'authenticated') then
    new.status := old.status;
    new.end_time := old.end_time;
    new.duration_seconds := old.duration_seconds;
    new.paused_seconds := old.paused_seconds;
    new.total_pay := old.total_pay;
    new.last_pause_time := old.last_pause_time;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_completed_time_entry on public.time_entries;
create trigger trg_protect_completed_time_entry
  before update on public.time_entries
  for each row execute function public.protect_completed_time_entry();
