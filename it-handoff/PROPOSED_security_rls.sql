-- ═════════════════════════════════════════════════════════════════════════════
-- PROPOSAL FOR IT — NOT APPLIED, NOT PART OF THE APP YET
-- This is a starting draft only; it has NOT been tested against a real
-- database. It only works together with switching the app's sign-in to
-- Supabase Auth (email + password) — the current app signs in with PINs, and
-- running this file alone would lock everyone out. IT decides the approach.
-- See it-handoff/IT-HANDOFF.md → "Security".
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- DRAFT — SECURITY (sign-in required + per-person access)
--
-- Run AFTER supabase_migration_002_contracts.sql, in Supabase → SQL Editor.
-- Safe to run again.
--
-- What it does, in plain English:
--   • Removes the old "Public Full Access" rules. Nobody can read or change
--     anything without signing in (Supabase Auth, email + password).
--   • A signed-in person is matched to the team by their EMAIL in "employees".
--   • Admins (role = 'admin') can see and change everything.
--   • Team members can only see their own profile, time, screenshots,
--     contracts, payments and timesheet status — and the project list.
--   • Team members can track their own time, but the DATABASE sets their pay
--     rate and pay amount, so nobody can change their own rate or pay.
--   • Team members can submit their timesheet, but only admins can approve it.
--
-- BEFORE running: make sure the owner row exists with the right email
-- (supabase_add_owner.sql), or you will lock yourself out of admin.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Helper functions ---------------------------------------------------------

-- The team member (employees.id) for the signed-in email, or NULL.
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id FROM public.employees e
  WHERE lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND e.active = true
  LIMIT 1;
$$;

-- True when the signed-in person is an active admin.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      AND e.active = true
      AND e.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.current_employee_id() FROM public, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2) Remove the old open policies --------------------------------------------

DROP POLICY IF EXISTS "Public Full Access Employees" ON public.employees;
DROP POLICY IF EXISTS "Public Full Access Clients" ON public.clients;
DROP POLICY IF EXISTS "Public Full Access Time Entries" ON public.time_entries;
DROP POLICY IF EXISTS "Public Full Access Screenshots" ON public.screenshots;
DROP POLICY IF EXISTS "Public Full Access App Settings" ON public.app_settings;
DROP POLICY IF EXISTS "Public Full Access Contracts" ON public.contracts;
DROP POLICY IF EXISTS "Public Full Access Payouts" ON public.payouts;
DROP POLICY IF EXISTS "Public Full Access Timesheet Approvals" ON public.timesheet_approvals;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_approvals ENABLE ROW LEVEL SECURITY;

-- Logged-out visitors get nothing at all.
REVOKE ALL ON public.employees, public.clients, public.time_entries, public.screenshots,
  public.app_settings, public.contracts, public.payouts, public.timesheet_approvals FROM anon;

-- PINs are no longer used for sign-in. Clear them so they can't leak.
UPDATE public.employees SET pin = NULL WHERE pin IS NOT NULL;

-- 3) New policies ------------------------------------------------------------

-- employees: admins manage everyone; members read only their own row
DROP POLICY IF EXISTS "employees_admin_all" ON public.employees;
DROP POLICY IF EXISTS "employees_self_read" ON public.employees;
CREATE POLICY "employees_admin_all" ON public.employees FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "employees_self_read" ON public.employees FOR SELECT TO authenticated
  USING (id = public.current_employee_id());

-- clients (projects): whole team can read the list; admins change it
DROP POLICY IF EXISTS "clients_team_read" ON public.clients;
DROP POLICY IF EXISTS "clients_admin_write" ON public.clients;
CREATE POLICY "clients_team_read" ON public.clients FOR SELECT TO authenticated
  USING (public.current_employee_id() IS NOT NULL);
CREATE POLICY "clients_admin_write" ON public.clients FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- contracts: admins manage; members read their own
DROP POLICY IF EXISTS "contracts_admin_all" ON public.contracts;
DROP POLICY IF EXISTS "contracts_self_read" ON public.contracts;
CREATE POLICY "contracts_admin_all" ON public.contracts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "contracts_self_read" ON public.contracts FOR SELECT TO authenticated
  USING ("employeeId" = public.current_employee_id());

-- time_entries: admins manage; members read/add/update their own (no delete)
DROP POLICY IF EXISTS "time_admin_all" ON public.time_entries;
DROP POLICY IF EXISTS "time_self_read" ON public.time_entries;
DROP POLICY IF EXISTS "time_self_insert" ON public.time_entries;
DROP POLICY IF EXISTS "time_self_update" ON public.time_entries;
CREATE POLICY "time_admin_all" ON public.time_entries FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "time_self_read" ON public.time_entries FOR SELECT TO authenticated
  USING ("employeeId" = public.current_employee_id());
CREATE POLICY "time_self_insert" ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK ("employeeId" = public.current_employee_id());
-- Members may update their own entries while their timesheet isn't approved yet
CREATE POLICY "time_self_update" ON public.time_entries FOR UPDATE TO authenticated
  USING (
    "employeeId" = public.current_employee_id()
    AND NOT EXISTS (
      SELECT 1 FROM public.timesheet_approvals a
      WHERE a."employeeId" = time_entries."employeeId"
        AND a.status = 'approved'
        AND time_entries."startTime" >= a."periodStart"
        AND time_entries."startTime" < a."periodEnd" + 86400000
    )
  )
  WITH CHECK ("employeeId" = public.current_employee_id());

-- Pay protection: for non-admins the database sets the rate and pay amount.
CREATE OR REPLACE FUNCTION public.enforce_time_entry_pay()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  rate numeric;
BEGIN
  IF public.is_admin() OR auth.role() = 'service_role' THEN
    NEW."totalPay" := round((NEW."durationSeconds"::numeric / 3600) * NEW."hourlyRate", 2);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Members can't move an entry to another person or change its rate
    NEW."employeeId" := OLD."employeeId";
    NEW."hourlyRate" := OLD."hourlyRate";
  ELSE
    SELECT c."payRate" INTO rate FROM public.contracts c
      WHERE c."employeeId" = NEW."employeeId" AND c."clientId" = NEW."clientId" AND c.active
      LIMIT 1;
    IF rate IS NULL THEN
      SELECT e."hourlyRate" INTO rate FROM public.employees e WHERE e.id = NEW."employeeId";
    END IF;
    NEW."hourlyRate" := coalesce(rate, 0);
  END IF;

  NEW."totalPay" := round((NEW."durationSeconds"::numeric / 3600) * NEW."hourlyRate", 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS time_entries_enforce_pay ON public.time_entries;
CREATE TRIGGER time_entries_enforce_pay
  BEFORE INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_time_entry_pay();

-- screenshots: admins manage; members read/add their own
DROP POLICY IF EXISTS "shots_admin_all" ON public.screenshots;
DROP POLICY IF EXISTS "shots_self_read" ON public.screenshots;
DROP POLICY IF EXISTS "shots_self_insert" ON public.screenshots;
DROP POLICY IF EXISTS "shots_self_update" ON public.screenshots;
CREATE POLICY "shots_admin_all" ON public.screenshots FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "shots_self_read" ON public.screenshots FOR SELECT TO authenticated
  USING ("employeeId" = public.current_employee_id());
CREATE POLICY "shots_self_insert" ON public.screenshots FOR INSERT TO authenticated
  WITH CHECK ("employeeId" = public.current_employee_id());
CREATE POLICY "shots_self_update" ON public.screenshots FOR UPDATE TO authenticated
  USING ("employeeId" = public.current_employee_id())
  WITH CHECK ("employeeId" = public.current_employee_id());

-- app_settings: team reads (screenshot interval etc.); admins change
DROP POLICY IF EXISTS "settings_team_read" ON public.app_settings;
DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;
CREATE POLICY "settings_team_read" ON public.app_settings FOR SELECT TO authenticated
  USING (public.current_employee_id() IS NOT NULL);
CREATE POLICY "settings_admin_write" ON public.app_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- The old admin PIN is no longer used
UPDATE public.app_settings SET "adminPin" = '', admin_pin = NULL;

-- payouts: admins manage; members read their own
DROP POLICY IF EXISTS "payouts_admin_all" ON public.payouts;
DROP POLICY IF EXISTS "payouts_self_read" ON public.payouts;
CREATE POLICY "payouts_admin_all" ON public.payouts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "payouts_self_read" ON public.payouts FOR SELECT TO authenticated
  USING ("employeeId" = public.current_employee_id());

-- timesheet_approvals: admins manage; members read their own and can only
-- SUBMIT (never approve), and not after it's approved
DROP POLICY IF EXISTS "approvals_admin_all" ON public.timesheet_approvals;
DROP POLICY IF EXISTS "approvals_self_read" ON public.timesheet_approvals;
DROP POLICY IF EXISTS "approvals_self_submit" ON public.timesheet_approvals;
DROP POLICY IF EXISTS "approvals_self_resubmit" ON public.timesheet_approvals;
CREATE POLICY "approvals_admin_all" ON public.timesheet_approvals FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "approvals_self_read" ON public.timesheet_approvals FOR SELECT TO authenticated
  USING ("employeeId" = public.current_employee_id());
CREATE POLICY "approvals_self_submit" ON public.timesheet_approvals FOR INSERT TO authenticated
  WITH CHECK ("employeeId" = public.current_employee_id() AND status = 'submitted');
CREATE POLICY "approvals_self_resubmit" ON public.timesheet_approvals FOR UPDATE TO authenticated
  USING ("employeeId" = public.current_employee_id() AND status <> 'approved')
  WITH CHECK ("employeeId" = public.current_employee_id() AND status = 'submitted');

-- 4) Table access for signed-in users (policies above decide which rows) -----
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees, public.clients, public.time_entries,
  public.screenshots, public.app_settings, public.contracts, public.payouts,
  public.timesheet_approvals TO authenticated;
