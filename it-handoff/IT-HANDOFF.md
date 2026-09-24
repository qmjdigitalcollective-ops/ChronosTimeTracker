# Auravia Time Tracker — Handoff for IT

Hi! This is the updated version of the time tracker you built. Queen asked for
changes so it can replace WebWork. This note explains what changed, how to put
it live, and what we'd like **you** to decide.

Nothing has been pushed to GitHub or changed in the live Supabase database yet.
Everything was tested on a local copy with test data only.

---

## 1. Quick summary

- **Look:** Auravia Collective branding (forest / gold / ivory, logo, Poppins +
  Montserrat), line icons, no emoji.
- **Money:** everything is in PHP (₱).
- **Layout:** admins get a side menu (like WebWork) that can fold down to icons.
  Home → **Overview** (next payday countdown, team pay so far, timesheets
  submitted, unpaid-last-period alert, who's working) and **My Timer**. A running
  timer shows in the top bar on every page. Team members only see their timer page.
- **New admin pages:** Timesheet (view / add / edit time), Timesheet Approval,
  Real Time, Tracked Hours, Team Pay, Payments, Client Earnings, Projects,
  Contracts. Most tables can be edited directly (click a cell, change it, it saves).
  Clicking a project (or "Team & rates") shows each member's pay/bill rate on it.
- **Team member view:** their own time and earnings by today / week / pay period /
  custom dates, and a "Submit timesheet" button. Their default rate is not shown,
  because rates differ per project.
- **Team Access (Settings):** Queen chooses what team members can see and do, for
  everyone or per person: see earnings, pay panel, submit timesheet, past time,
  all projects, screenshots.
- **Payslips:** after "Mark as paid", admins (Team Pay / Payments) and the team
  member (their pay panel) can open a branded payslip (hours per project, rate,
  amount, adjustment if any) and **Print / Save as PDF**. Nothing new is stored;
  it's built from the payment record and time entries.
- **Starting PINs:** first name + 23 (e.g. `kyeth23`, not case-sensitive). On the
  first sign-in, the app requires everyone to choose their own PIN.
- **3 bugs fixed** (see section 5).

---

## 2. How to put it live (step by step)

1. **Back up the database first.** Supabase → Database → Backups, or export the tables.
2. **Run `supabase_migration_002_contracts.sql`** in Supabase → SQL Editor.
   - It only **adds** 4 new tables: `contracts`, `payouts`, `timesheet_approvals`,
     `team_permissions`.
   - It does not change or delete existing tables or data.
   - Their access rules copy the current open rules, so the app keeps working
     the same way (see section 6, Security).
3. **Add the owner account.** Run `supabase_add_owner.sql`, or add Queen under
   Manage → People. She signs in with `qmjdigitalcollective@gmail.com` and the
   starting PIN `queen23`. The app then asks her to choose her own PIN.
4. **Update the code.** Replace the project files with this version (or compare
   it with your repo), then run:
   ```
   npm install
   npm run build
   ```
   Deploy the way you normally do (push to GitHub → hosting).
5. **Load the real team data (optional).** Queen has a separate file,
   `auravia-team-setup-import.json` (team, 8 projects, 22 contracts copied from
   WebWork). Import it in the app: Manage → Settings → Import JSON Backup.
   That file is **kept out of the code on purpose**, so pay rates never end up on GitHub.
6. **Check it:** sign in as Queen, open each menu page, add a test time entry,
   then delete it.

If step 2 is skipped, the app still runs, but contracts, payments, approvals and
Team Access are only saved in the browser where they were created. A yellow warning shows
on the Projects and Contracts pages until the tables exist.

---

## 3. What changed, file by file

| File | What changed |
|---|---|
| `src/styles.css` | Brand color tokens (`--av-*`) and fonts. All colors come from here. |
| `src/index.html`, `public/*` | Title, Google Fonts, logo, icons, manifest. |
| `public/sw.js` | Offline cache is now **network-first** (see bug #3). |
| `src/app/app.constants.ts` | **New.** Currency (PHP / ₱) in one place. |
| `src/app/pipes/money.pipe.ts` | **New.** Formats money as ₱1,234.56. |
| `src/app/components/icon/icon.component.ts` | **New.** Line icons (SVG). |
| `src/app/services/rates.ts` | **New.** Picks the pay and bill rate: contract first, then the default. |
| `src/app/services/pay-period.ts` | **New.** Pay periods are the 1st–15th and the 16th–end of the month. |
| `src/app/services/permissions.ts` | **New.** Team Access defaults and "who gets what" logic. |
| `src/app/components/payslip/payslip.component.ts` | **New.** Payslip view + print. Print-only CSS is in `src/styles.css` (`body.printing-payslip`). |
| `src/app/services/nav.service.ts` | **New.** Lets the top bar open a page (the running-timer pill opens My Timer). |
| `src/app/app.html` | Admins see the menu layout only (My Timer is a page in it); team members see only their timer. |
| `src/app/models/time-tracker.models.ts` | Added `Contract`, `Payout`, `TimesheetApproval`, `MemberPermissions`, `TeamPermissionRow`, `MANUAL_ENTRY_PREFIX`. |
| `src/app/services/offline-storage.service.ts` | Read/write for the 4 new tables (with local fallback), import/export includes them, real upload for offline sync, keeps unsynced local time on refresh, no demo time entries pushed to an empty database. |
| `src/app/services/timer.service.ts` | Clock-in uses the contract pay rate. Restores only the signed-in person's timer (bug #1). |
| `src/app/services/google-sync.service.ts` | "Sync to Cloud" now really uploads (bug #2). |
| `src/app/services/auth.service.ts` | Sign in with **email or Employee ID** (+ PIN, same as before). PINs not case-sensitive. Starting PIN (first name + 23) must be changed on first sign-in (`mustChangePin`). |
| `src/app/components/admin-dashboard/…` | Rebuilt: side menu, pay-period picker, all the new pages, inline editing. This is the biggest file. |
| `src/app/components/user-tracker/…` | Team member view: pay panel, week / custom dates, submit timesheet, only their assigned projects. |
| `src/app/components/navbar/…`, `login/…` | Rebrand; no rate shown in the header for team members. |
| `angular.json` | Component style budget raised (32 kB warning / 48 kB error). |
| `supabase_migration_002_contracts.sql` | **New.** The 4 new tables. |
| `src/app/app.spec.ts` | One test updated (PIN wording) and one test added (starting PIN). 15 tests pass. |
| `supabase_add_owner.sql` | **New.** Adds Queen's owner account. |
| `supabase_schema.sql` | Seed admin changed from the demo "Sarah" to Queen. |

How some things work:

- **Rates:** a *contract* sets the pay and bill rate for one person on one project.
  With no contract, the person's default pay rate and the project's default bill
  rate are used.
- **Pay on each entry** is still saved on the entry when it's created
  (`hourlyRate`, `totalPay`), so changing a rate later doesn't change past pay.
- **Bill amounts** are worked out when reports are shown, using the *current*
  rates. They are not saved on the entry, so no database column was needed.
- **Manual time** added through "Add time" gets an id that starts with `manual_`.
  That's how it's tagged, with no new column.

---

## 4. Testing done

- `npm run build`: no errors, no warnings.
- `ng test`: all 15 tests pass (14 existing + 1 new).
- Clicked through every page in a browser (desktop and phone size) with test data:
  - Rates from contracts apply correctly when time is added.
  - Totals, pay, bill and margin are correct.
  - Submit → approve → mark as paid works.
  - Inline edits save and update the reports.
- **Not tested** against a real Supabase database. Please try it on a copy or
  staging first if you can.

---

## 5. Bugs found in the original code (fixed)

1. **Wrong person's timer.** On opening the app, it restored *any* running timer
   in the whole team, not just the signed-in person's. Someone could see, or
   clock out, another person's timer. Fixed: `timer.service.ts →
   restoreActiveSession(employeeId)`.
2. **Offline time was never uploaded.** "Sync to Cloud" only changed the sync
   status. It never sent time that was saved while offline. Also, when the app
   refreshed from the cloud it overwrote the local copy, so that time could be
   lost. Fixed: `uploadPending()` plus a merge in `getTimeEntries()`.
3. **Old version kept loading after updates.** The service worker served the
   cached page first, forever. Fixed: it now loads from the network first and
   uses the cache only when offline.

---

## 6. For you to decide

### Security (most important)

Right now **anyone who finds the site can read and change all data**:

- The Supabase tables use "Public Full Access" rules.
- The app's key is public, which is normal for Supabase, but it only stays
  safe with proper rules.
- PINs are stored as plain text, and the PIN check happens in the browser.

We **did not change this**; Queen asked that you choose the approach. There's a
starting draft in `it-handoff/PROPOSED_security_rls.sql`:

- Sign in with Supabase Auth. **Queen's preference is Google** (see below).
- Each person is matched to the team by email.
- Row Level Security: team members see only their own data; admins see everything.
- A trigger so the database sets the pay rate and pay amount, so nobody can
  raise their own pay.
- Members can submit timesheets but can't approve them.

**It is a draft and not tested.** It also needs the app's sign-in changed to
Supabase Auth. Running it alone would lock everyone out.

### Queen's choice: Sign in with Google (how to set it up)

Everyone on the team uses a Gmail address, so Queen would like everyone to sign in
with **"Sign in with Google"** instead of PINs. It's also what makes the database
rules above work, because Supabase then knows who is signed in.

**A. Google Cloud (about 10 minutes)**
1. Go to console.cloud.google.com → create a project (e.g. "Auravia Time Tracker").
2. APIs & Services → **OAuth consent screen**:
   - User type **External**, app name "Auravia Collective Time Tracker", support email
     `qmjdigitalcollective@gmail.com`, and upload the logo if you like.
   - Scopes: only `email`, `profile`, `openid`.
   - Either add each team member's Gmail as a **test user**, or publish the app
     ("In production"). With only these basic scopes, Google doesn't need to review it.
3. APIs & Services → **Credentials** → Create credentials → **OAuth client ID** →
   type **Web application**.
   - Authorized JavaScript origins: the live site URL (and `http://localhost:4200` for testing).
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (Supabase shows this exact URL in step B).
4. Copy the **Client ID** and **Client secret**. Keep the secret out of the code and GitHub.

**B. Supabase**
1. Authentication → **Sign In / Providers** → **Google** → enable, then paste the Client ID and secret.
2. Authentication → **URL Configuration**:
   - Site URL = the live site URL.
   - Redirect URLs: add the live URL and `http://localhost:4200`.
3. Optional but recommended: turn off email/password sign-ups, so Google is the
   only way in.

**C. App changes (small)**
- On the login screen, replace the email + PIN form with one button that calls:
  ```ts
  getSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  ```
- In `auth.service.ts`, on start-up call `auth.getSession()` (and listen with
  `auth.onAuthStateChange`). Take `session.user.email` and find the **active**
  employee with that email. If there's no match, sign out and show "This Google
  account isn't on the Auravia team. Ask Queen to add you."
- Log out = `auth.signOut()`.
- Remove the PIN parts: the Change PIN button, `mustChangePin`, and the PIN field
  in People. Queen adds people by **email** in Manage → People. Their Gmail is
  their login.
- Cache the signed-in employee (like the app does now), so the tracker still opens
  offline after the first sign-in.

**D. Database**
- Then apply the rules in `it-handoff/PROPOSED_security_rls.sql` (review and test
  them first). They find the signed-in person by `auth.jwt() ->> 'email'`, which
  Google sign-in provides.
- After that, clear the old `pin` values.

**E. Desktop app (Electron)**
- Google blocks sign-in inside embedded app windows. For the desktop app, open
  the Google sign-in in the system browser and return to the app with a deep link
  (or a local redirect), or have the desktop app use the website's session. This
  can come after the web version works.

**F. Test before switching everyone**
1. Queen signs in with Google → she lands in the admin area.
2. One team member signs in → they see only their own time.
3. An outside Gmail signs in → it's refused.
4. Signed out → nothing loads from the database. You can check this in the
   browser's network tab.

**Note:** Team Access and "only see your own data" are currently enforced **in the
app only**, so they hide things in the screens. Real enforcement needs the database
security above. Once security is in place, Team Access can be enforced in the
database too.

### Other things worth a look

- **Demo data:** on an empty database, the app still seeds demo employees and
  clients (Acme, John Doe…). We stopped it seeding demo *time entries*. You may
  want to turn the rest off too (`_seedDefaults` in `offline-storage.service.ts`).
- **Save errors:** many Supabase calls don't check the returned `error`, so a
  failed save can look like it worked. The new code checks errors; the older
  save functions mostly don't.
- **Unused code:** `google-apps-script/` and `skip/` don't seem to be used
  anymore. The Settings page also still shows an "Admin PIN" setting.
- **Screenshots** are saved as base64 text in the database, which gets large
  fast. Supabase Storage would be better long term.
- **Client bill rates:** most WebWork bill rates are the same as the pay rates
  (only VIRAL has a real bill rate), so margins show ₱0 until Queen enters the
  real client rates. She can do that herself on the Contracts / Projects pages.

---

## 7. Queen's future plans (for context, not part of this update)

These are coming later. Knowing them now may help when you choose the security
and database setup.

1. **Security first.** Your decision in section 6. Everything below builds on it.
2. **Payslips by email.** The payslip itself is built (in-app + PDF). Next step: when
   Queen clicks "Mark as paid", the team member also gets it by email.
   - Needs a small server piece, because email can't be sent safely from the
     browser. For example, a Supabase Edge Function plus an email service (e.g. Resend).
   - Simple first step: the payslip shows inside the app and can be saved as PDF.
3. **Client invoices.** Create invoices from Client Earnings (hours × bill rate
   per project), save them, mark them sent/paid, and email them to the client.
   Same email setup as payslips.
4. **Read-only access for Queen's own reports.** Later, Queen may ask for a
   **read-only** key or login that can read the Payments (`payouts`) table.
   Please keep that possible when you set up security (a read-only role or view is enough).
5. **Smaller ideas:** team "time requests" (ask to add missed time, admin approves),
   saving the bill rate on each entry (needs a new column), and moving screenshots
   to Supabase Storage.

Questions? Queen can pass them along. Thank you!
