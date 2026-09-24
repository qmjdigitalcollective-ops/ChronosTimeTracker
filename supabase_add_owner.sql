-- ─────────────────────────────────────────────────────────────────────────────
-- ADD / UPDATE THE OWNER ACCOUNT (run once in Supabase → SQL Editor)
-- Lets Queen sign in with qmjdigitalcollective@gmail.com.
-- Starting PIN is queen23 (first name + 23). The app asks you to choose your own PIN on first sign-in.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.employees (id, name, email, role, "hourlyRate", pin, department, "avatarColor", active)
VALUES ('owner-queen', 'Queen (Owner)', 'qmjdigitalcollective@gmail.com', 'admin', 0, 'queen23', 'Owner', '#063c35', true)
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      role = 'admin',
      department = 'Owner',
      active = true;
