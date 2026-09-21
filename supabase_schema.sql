-- ─────────────────────────────────────────────────────────────────────────────
-- ⚡ SUPABASE COMPLETE DATABASE SETUP SCRIPT FOR TIME TRACKER
-- Copy and run this entire script in your Supabase SQL Editor:
-- Supabase Dashboard -> SQL Editor -> New Query -> Paste & Run
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. EMPLOYEES TABLE
CREATE TABLE IF NOT EXISTS public.employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    "hourlyRate" NUMERIC NOT NULL DEFAULT 0,
    hourly_rate NUMERIC DEFAULT 0,
    pin TEXT,
    department TEXT,
    "avatarColor" TEXT,
    avatar_color TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLIENTS TABLE
CREATE TABLE IF NOT EXISTS public.clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    "defaultRate" NUMERIC DEFAULT 0,
    default_rate NUMERIC DEFAULT 0,
    color TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TIME ENTRIES TABLE
CREATE TABLE IF NOT EXISTS public.time_entries (
    id TEXT PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    employee_id TEXT,
    "employeeName" TEXT NOT NULL,
    employee_name TEXT,
    "clientId" TEXT NOT NULL,
    client_id TEXT,
    "clientName" TEXT NOT NULL,
    client_name TEXT,
    "taskDescription" TEXT NOT NULL,
    task_description TEXT,
    "startTime" BIGINT NOT NULL,
    start_time BIGINT,
    "endTime" BIGINT,
    end_time BIGINT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    "pausedSeconds" INTEGER NOT NULL DEFAULT 0,
    paused_seconds INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    "hourlyRate" NUMERIC NOT NULL DEFAULT 0,
    hourly_rate NUMERIC DEFAULT 0,
    "totalPay" NUMERIC NOT NULL DEFAULT 0,
    total_pay NUMERIC DEFAULT 0,
    "screenshotCount" INTEGER NOT NULL DEFAULT 0,
    screenshot_count INTEGER DEFAULT 0,
    "syncStatus" TEXT NOT NULL DEFAULT 'synced',
    sync_status TEXT DEFAULT 'synced',
    "syncedAt" BIGINT,
    synced_at BIGINT,
    "lastSyncError" TEXT,
    last_sync_error TEXT,
    "lastPauseTime" BIGINT,
    last_pause_time BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SCREENSHOTS TABLE
CREATE TABLE IF NOT EXISTS public.screenshots (
    id TEXT PRIMARY KEY,
    "timeEntryId" TEXT NOT NULL,
    time_entry_id TEXT,
    "employeeId" TEXT NOT NULL,
    employee_id TEXT,
    "employeeName" TEXT NOT NULL,
    employee_name TEXT,
    timestamp BIGINT NOT NULL,
    "imageDataUrl" TEXT NOT NULL,
    image_data_url TEXT,
    "thumbnailDataUrl" TEXT,
    thumbnail_data_url TEXT,
    "driveFileId" TEXT,
    drive_file_id TEXT,
    "driveViewUrl" TEXT,
    drive_view_url TEXT,
    synced BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" BIGINT,
    synced_at BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. APP SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.app_settings (
    id TEXT PRIMARY KEY DEFAULT 'appSettings',
    "screenshotIntervalMinutes" INTEGER NOT NULL DEFAULT 10,
    screenshot_interval_minutes INTEGER DEFAULT 10,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    auto_sync BOOLEAN DEFAULT true,
    "adminPin" TEXT NOT NULL DEFAULT 'admin123',
    admin_pin TEXT DEFAULT 'admin123',
    "activeEmployeeId" TEXT,
    active_employee_id TEXT,
    "activeRole" TEXT,
    active_role TEXT,
    "lastSyncTime" BIGINT,
    last_sync_time BIGINT,
    "allowMockScreenshotsIfDenied" BOOLEAN NOT NULL DEFAULT true,
    allow_mock_screenshots_if_denied BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Enable RLS and grant FULL PUBLIC ACCESS to anon/authenticated users
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Public Full Access Employees" ON public.employees;
DROP POLICY IF EXISTS "Public Full Access Clients" ON public.clients;
DROP POLICY IF EXISTS "Public Full Access Time Entries" ON public.time_entries;
DROP POLICY IF EXISTS "Public Full Access Screenshots" ON public.screenshots;
DROP POLICY IF EXISTS "Public Full Access App Settings" ON public.app_settings;

-- Create permissive RLS policies
CREATE POLICY "Public Full Access Employees" ON public.employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Full Access Clients" ON public.clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Full Access Time Entries" ON public.time_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Full Access Screenshots" ON public.screenshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Full Access App Settings" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);

-- Seed Initial Default Employees if empty
INSERT INTO public.employees (id, name, email, role, "hourlyRate", pin, department, "avatarColor", active)
VALUES 
  ('emp-1', 'Sarah Connor (Admin)', 'sarah.connor@example.com', 'admin', 55.0, '1234', 'Management & Ops', '#6366f1', true),
  ('emp-2', 'John Doe (Developer)', 'john.doe@example.com', 'user', 35.0, '1234', 'Engineering', '#0ea5e9', true),
  ('emp-3', 'Jane Smith (UI Designer)', 'jane.smith@example.com', 'user', 40.0, '1234', 'Product Design', '#ec4899', true),
  ('emp-4', 'Alex Rivera (QA Tester)', 'alex.rivera@example.com', 'user', 30.0, '1234', 'Quality Assurance', '#10b981', true)
ON CONFLICT (id) DO NOTHING;

-- Seed Initial Default Clients if empty
INSERT INTO public.clients (id, name, code, "defaultRate", color, active)
VALUES
  ('cli-1', 'Acme Corporation', 'ACM', 50, '#3b82f6', true),
  ('cli-2', 'Stark Global', 'STK', 65, '#ef4444', true),
  ('cli-3', 'Wayne Enterprises', 'WYN', 75, '#10b981', true),
  ('cli-4', 'Cyberdyne Systems', 'CYB', 45, '#8b5cf6', true)
ON CONFLICT (id) DO NOTHING;

-- Seed Initial Default App Settings if empty
INSERT INTO public.app_settings (id, "screenshotIntervalMinutes", "autoSync", "adminPin", "allowMockScreenshotsIfDenied")
VALUES ('appSettings', 10, true, 'admin123', true)
ON CONFLICT (id) DO NOTHING;
