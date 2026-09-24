-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 002 — Contracts (rates per member per project), Payouts,
--                 Timesheet Approvals, and Team Access (permissions)
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Safe to run again (uses IF NOT EXISTS). Does not change existing tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contracts (
    id TEXT PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "payRate" NUMERIC NOT NULL DEFAULT 0,
    "billRate" NUMERIC NOT NULL DEFAULT 0,
    "weeklyLimitHours" NUMERIC,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payouts (
    id TEXT PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "periodStart" BIGINT NOT NULL,
    "periodEnd" BIGINT NOT NULL,
    hours NUMERIC NOT NULL DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0,
    "paidAt" BIGINT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.timesheet_approvals (
    id TEXT PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "periodStart" BIGINT NOT NULL,
    "periodEnd" BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    hours NUMERIC NOT NULL DEFAULT 0,
    "submittedAt" BIGINT NOT NULL,
    "reviewedAt" BIGINT,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team access: what team members can see/do. id = 'default' (everyone) or an employee id
CREATE TABLE IF NOT EXISTS public.team_permissions (
    id TEXT PRIMARY KEY,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_permissions ENABLE ROW LEVEL SECURITY;

-- NOTE: these match the existing tables' "open" policy so the app keeps working.
-- They should be tightened together with the other tables once real logins
-- (Supabase Auth) are added — see UPDATE-NOTES.md.
DROP POLICY IF EXISTS "Public Full Access Contracts" ON public.contracts;
DROP POLICY IF EXISTS "Public Full Access Payouts" ON public.payouts;
DROP POLICY IF EXISTS "Public Full Access Timesheet Approvals" ON public.timesheet_approvals;
DROP POLICY IF EXISTS "Public Full Access Team Permissions" ON public.team_permissions;
CREATE POLICY "Public Full Access Contracts" ON public.contracts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Full Access Payouts" ON public.payouts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Full Access Timesheet Approvals" ON public.timesheet_approvals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Full Access Team Permissions" ON public.team_permissions FOR ALL USING (true) WITH CHECK (true);
