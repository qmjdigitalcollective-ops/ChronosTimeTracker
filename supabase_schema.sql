-- ─────────────────────────────────────────────────────────────────────────────
-- TIME TRACKER — SUPABASE DATABASE SETUP
-- Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- Safe to run more than once: it only creates what is missing and never
-- deletes rows. Column names are snake_case, which is what the app uses.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. EMPLOYEES
CREATE TABLE IF NOT EXISTS public.employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    hourly_rate NUMERIC NOT NULL DEFAULT 0,
    pin TEXT,
    department TEXT,
    avatar_color TEXT,
    active BOOLEAN NOT NULL DEFAULT true
);

-- 2. CLIENTS (projects)
CREATE TABLE IF NOT EXISTS public.clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    default_rate NUMERIC,
    color TEXT,
    active BOOLEAN NOT NULL DEFAULT true
);

-- 3. TIME ENTRIES
CREATE TABLE IF NOT EXISTS public.time_entries (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL DEFAULT '',
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL DEFAULT '',
    task_description TEXT NOT NULL DEFAULT '',
    start_time BIGINT NOT NULL,
    end_time BIGINT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    paused_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    hourly_rate NUMERIC NOT NULL DEFAULT 0,
    total_pay NUMERIC NOT NULL DEFAULT 0,
    screenshot_count INTEGER NOT NULL DEFAULT 0,
    last_pause_time BIGINT
);

-- 4. SCREENSHOTS
CREATE TABLE IF NOT EXISTS public.screenshots (
    id TEXT PRIMARY KEY,
    time_entry_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL DEFAULT '',
    timestamp BIGINT NOT NULL,
    image_data_url TEXT NOT NULL,
    thumbnail_data_url TEXT,
    drive_file_id TEXT,
    drive_view_url TEXT
);

-- 5. APP SETTINGS (one row)
CREATE TABLE IF NOT EXISTS public.app_settings (
    id TEXT PRIMARY KEY DEFAULT 'appSettings',
    screenshot_interval_minutes INTEGER NOT NULL DEFAULT 10,
    admin_pin TEXT NOT NULL DEFAULT 'admin123',
    active_employee_id TEXT,
    active_role TEXT,
    allow_mock_screenshots_if_denied BOOLEAN NOT NULL DEFAULT true
);

-- 6. CONTRACTS (pay & bill rate per member per project)
CREATE TABLE IF NOT EXISTS public.contracts (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    pay_rate NUMERIC NOT NULL DEFAULT 0,
    bill_rate NUMERIC NOT NULL DEFAULT 0,
    weekly_limit_hours NUMERIC,
    active BOOLEAN NOT NULL DEFAULT true
);

-- 7. PAYOUTS (who was paid for which pay period)
CREATE TABLE IF NOT EXISTS public.payouts (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL DEFAULT '',
    period_start BIGINT NOT NULL,
    period_end BIGINT NOT NULL,
    hours NUMERIC NOT NULL DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0,
    paid_at BIGINT NOT NULL,
    note TEXT
);

-- 8. TIMESHEET APPROVALS (member submits, admin approves)
CREATE TABLE IF NOT EXISTS public.timesheet_approvals (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL DEFAULT '',
    period_start BIGINT NOT NULL,
    period_end BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    hours NUMERIC NOT NULL DEFAULT 0,
    submitted_at BIGINT NOT NULL,
    reviewed_at BIGINT,
    note TEXT
);

-- 9. TEAM ACCESS (id = 'default' for everyone, or an employee id)
CREATE TABLE IF NOT EXISTS public.team_permissions (
    id TEXT PRIMARY KEY,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Older setups have sync columns the app no longer writes; make sure they can't block saves
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND is_nullable = 'NO' AND (table_name, column_name) IN (
      ('time_entries', 'sync_status'), ('time_entries', 'synced_at'), ('time_entries', 'last_sync_error'),
      ('screenshots', 'synced'), ('screenshots', 'synced_at'),
      ('app_settings', 'auto_sync'), ('app_settings', 'last_sync_time')
    )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', c.table_name, c.column_name);
  END LOOP;
END $$;

-- Settings row, only if the table is empty
INSERT INTO public.app_settings (id)
SELECT 'appSettings' WHERE NOT EXISTS (SELECT 1 FROM public.app_settings);

-- ─────────────────────────────────────────────────────────────────────────────
-- ACCESS
-- The app signs people in with its own email + PIN check (not Supabase Auth),
-- so it talks to the database as the public "anon" role. Every table must let
-- that role read and write, otherwise the app sees empty tables — which is why
-- sign-in said "Email or Employee ID not found".
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees', 'clients', 'time_entries', 'screenshots', 'app_settings',
    'contracts', 'payouts', 'timesheet_approvals', 'team_permissions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "App full access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "App full access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Refresh the API so new tables are visible right away
NOTIFY pgrst, 'reload schema';
