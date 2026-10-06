// gate — the one door the app is allowed to knock on.
//
// The app no longer talks to Supabase directly for anything sensitive.
// On login, it sends { op: "login", employeeId or email, pin } here and gets
// back a short-lived session token. Every request after that carries that
// token instead of the raw PIN. This function checks the token (or, for
// login, the PIN itself) against the real database — using the service-role
// key, which never leaves the server — decides what that person is allowed
// to touch, and only then performs the database operation.
//
// This is what makes it safe to lock the database's own rules down to
// "nobody gets in directly" — the public URL + anon key stop being useful
// to anyone who finds them, because they can no longer reach the data
// without also knowing a real PIN.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SESSION_HOURS = 12;

// Tables a regular team member can write to, but only their OWN row.
// "employees" is scoped by its own "id" column (not "employee_id"),
// and further limited to a small set of fields — see EMPLOYEE_SELF_EDITABLE_FIELDS.
const EMPLOYEE_WRITE_SCOPED: Record<string, string> = {
  time_entries: "employee_id",
  screenshots: "employee_id",
  timesheet_approvals: "employee_id",
  employees: "id",
  time_pauses: "employee_id",
  tasks: "employee_id",
  timer_events: "employee_id",
};

// The only fields a non-admin may change on their OWN employees row —
// e.g. their PIN. Everything else (role, rate, active, name...) is silently
// restored to whatever is already in the database, no matter what the
// request contained, so a team member can never grant themselves admin or
// give themselves a raise.
const EMPLOYEE_SELF_EDITABLE_FIELDS = ["pin"];

// A team member can update their own task's status (start/finish it), but
// never its title, client, or who it's assigned to.
const TASK_SELF_EDITABLE_FIELDS = ["status"];

// Tables a regular team member can only READ, never write —
// reference data needed to show rates, projects, and settings.
const EMPLOYEE_READABLE = ["clients", "contracts", "team_permissions", "app_settings"];

// Tables a regular team member can read, but only rows scoped to them.
const EMPLOYEE_READ_SCOPED: Record<string, string> = {
  payouts: "employee_id",
  time_entries: "employee_id",
  screenshots: "employee_id",
  timesheet_approvals: "employee_id",
  time_pauses: "employee_id",
  tasks: "employee_id",
  timer_events: "employee_id",
};

// Tables only an admin PIN may write to at all (aside from the employees
// self-edit carve-out above).
const ADMIN_ONLY_WRITE = ["clients", "contracts", "employees", "payouts", "team_permissions", "app_settings"];

// Browsers send a CORS preflight (OPTIONS) before the real POST from any
// origin — without these headers on every response, the browser blocks the
// request before it ever reaches this code, and the app just sees a generic
// network failure.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

// ── Login rate limiting ──────────────────────────────────────────────────────
// Nothing previously stopped a script from rapidly guessing 4-digit PINs.
// After MAX_ATTEMPTS wrong PINs for the same identifier within the window,
// that identifier is locked out until the window passes — tracked in the
// database (not in-memory) since Edge Functions don't share memory between
// invocations.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

async function checkLoginLock(
  admin: ReturnType<typeof createClient>,
  identifier: string
): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  const { data } = await admin.from("login_attempts").select("*").eq("identifier", identifier).maybeSingle();
  if (data?.locked_until && new Date(data.locked_until as string).getTime() > Date.now()) {
    const retryAfterSeconds = Math.ceil((new Date(data.locked_until as string).getTime() - Date.now()) / 1000);
    return { locked: true, retryAfterSeconds };
  }
  return { locked: false };
}

async function recordLoginResult(
  admin: ReturnType<typeof createClient>,
  identifier: string,
  success: boolean
): Promise<void> {
  if (success) {
    await admin.from("login_attempts").delete().eq("identifier", identifier);
    return;
  }

  const { data } = await admin.from("login_attempts").select("*").eq("identifier", identifier).maybeSingle();
  const now = Date.now();
  const windowMs = LOCKOUT_MINUTES * 60 * 1000;

  if (!data || now - new Date(data.first_failed_at as string).getTime() > windowMs) {
    await admin.from("login_attempts").upsert({
      identifier,
      failed_count: 1,
      first_failed_at: new Date(now).toISOString(),
      locked_until: null,
    });
    return;
  }

  const failedCount = (data.failed_count as number) + 1;
  const lockedUntil = failedCount >= MAX_ATTEMPTS ? new Date(now + windowMs).toISOString() : null;
  await admin.from("login_attempts").upsert({
    identifier,
    failed_count: failedCount,
    first_failed_at: data.first_failed_at,
    locked_until: lockedUntil,
  });
}

// ── Push a task's status back to ClickUp, best-effort ───────────────────────
// Our 3-state model (todo/in_progress/done) doesn't line up with whatever
// custom status names a ClickUp list actually uses, so this looks up that
// list's real statuses and picks the closest match by type rather than
// guessing a literal name — a mismatched name would just fail silently on
// ClickUp's end otherwise.
async function pushTaskStatusToClickUp(
  clickupTaskId: string,
  clickupListId: string | null,
  ourStatus: string
): Promise<void> {
  const key = Deno.env.get("CLICKUP_API_KEY");
  if (!key || !clickupListId) return;
  const headers = { Authorization: key, "Content-Type": "application/json" };

  const listRes = await fetch(`https://api.clickup.com/api/v2/list/${clickupListId}`, { headers });
  if (!listRes.ok) return;
  const list = await listRes.json();
  const statuses: { status: string; type: string }[] = list?.statuses ?? [];
  if (!statuses.length) return;

  const byType = (type: string) => statuses.find((s) => s.type === type);
  const target =
    ourStatus === "done"
      ? byType("closed") ?? statuses[statuses.length - 1]
      : ourStatus === "in_progress"
      ? byType("custom") ?? byType("open") ?? statuses[0]
      : byType("open") ?? statuses[0];
  if (!target) return;

  await fetch(`https://api.clickup.com/api/v2/task/${clickupTaskId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ status: target.status }),
  });
}

// ── Mint a real Supabase Auth session for an employee, behind their existing
// PIN login — so RLS and Realtime (which key off auth.uid()) can recognize
// "this is Kyeth" without changing anything about how the team actually logs
// in. Creates the auth.users row once (first login after this shipped),
// then reuses it. The PIN check above is still the real gate; this session
// is only ever used for read-only Realtime subscriptions, never for writes —
// those still go through this same function as before.
async function mintSupabaseSession(
  admin: ReturnType<typeof createClient>,
  employee: any
): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const email = employee.email || `${employee.id}@internal.auraviacollective.local`;
    let authUserId = employee.auth_user_id as string | null;

    if (!authUserId) {
      const { data: created, error: createErr } = await (admin as any).auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { employee_id: employee.id, role: employee.role },
      });
      if (createErr || !created?.user) return null;
      authUserId = created.user.id;
      await admin.from("employees").update({ auth_user_id: authUserId }).eq("id", employee.id);
    }

    const { data: link, error: linkErr } = await (admin as any).auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const hashedToken = link?.properties?.hashed_token;
    if (linkErr || !hashedToken) return null;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(supabaseUrl, anonKey);
    const { data: verified, error: verifyErr } = await asUser.auth.verifyOtp({
      token_hash: hashedToken,
      type: "email",
    });
    if (verifyErr || !verified?.session) return null;

    return { access_token: verified.session.access_token, refresh_token: verified.session.refresh_token };
  } catch {
    // Realtime is an enhancement, not the source of truth — if this fails for
    // any reason, login still succeeds and the app falls back to polling.
    return null;
  }
}


// ── Automatic "you've been paid" email, best-effort ──────────────────────────
function formatPeriodLabel(startMs: number, endMs: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
  const fmtWithYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
  return `${fmt.format(new Date(startMs))} – ${fmtWithYear.format(new Date(endMs))}`;
}

async function sendPayoutEmail(admin: ReturnType<typeof createClient>, payout: any): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return; // Not configured yet — payout still saves fine, just no email.

  const { data: employee } = await admin.from("employees").select("email, name").eq("id", payout.employee_id).maybeSingle();
  const email = (employee as any)?.email;
  if (!email) return;

  const periodLabel = formatPeriodLabel(payout.period_start, payout.period_end);
  const amount = Number(payout.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const name = (employee as any)?.name ?? payout.employee_name ?? "there";

  const trackerUrl = "https://tracker.auraviacollective.com";
  const logoUrl = "https://tracker.auraviacollective.com/auravia-mark.png";
  const firstName = String(name).replace(/\([^)]*\)/g, "").trim().split(/\s+/)[0] || name;
  const replyTo = "qmjdigitalcollective@gmail.com";

  const html = `
    <div style="font-family: -apple-system, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; background: #fffdf8;">
      <div style="padding: 28px 24px 16px; text-align: center; border-bottom: 2px solid #d9c98a;">
        <img src="${logoUrl}" alt="Auravia Collective" width="56" height="56" style="display: block; margin: 0 auto 10px;" />
        <div style="color: #0f3d33; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600;">Auravia Collective</div>
      </div>

      <div style="padding: 28px 24px; color: #1a2e28; border: 1px solid #ece4d2; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="color: #0f3d33; margin: 0 0 4px;">You've been paid ✓</h2>
        <p style="color: #555;">Hi ${firstName},</p>
        <p style="color: #555;">Your pay for <strong>${periodLabel}</strong> has been recorded. The actual transfer will be processed shortly — you'll see it in your account soon.</p>

        <div style="background: #f6f3ea; border-radius: 10px; padding: 20px; margin: 20px 0;">
          <div style="font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 0.05em;">Amount</div>
          <div style="font-size: 28px; font-weight: 700; color: #0f3d33;">₱${amount}</div>
        </div>

        <p style="color: #555;">You can view or print your full payslip anytime — open your
          <a href="${trackerUrl}" style="color: #0f3d33; font-weight: 600;">My Pay Period</a>
          page and look under
          <a href="${trackerUrl}" style="color: #0f3d33; font-weight: 600;">Payslip history</a>.
        </p>

        <p style="color: #555; margin-top: 24px;">Thank you for all the work you put in this period — it genuinely makes a difference for the team. Keep it up! 🌿</p>

        <div style="background: #f0f5f1; border-left: 3px solid #0f3d33; border-radius: 6px; padding: 16px 18px; margin: 24px 0;">
          <div style="font-weight: 600; color: #0f3d33; margin-bottom: 8px;">A quick check-in</div>
          <p style="color: #555; margin: 0 0 6px; font-size: 14px;">Just hit reply and let me know:</p>
          <ul style="color: #555; font-size: 14px; margin: 0; padding-left: 18px;">
            <li>What do you think you could improve on?</li>
            <li>What's working well that we should keep doing?</li>
          </ul>
        </div>

        <p style="color: #999; font-size: 13px; margin-top: 28px;">Auravia Collective · Questions? Just reply to this email.</p>
      </div>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Auravia Collective <payroll@mail.auraviacollective.com>",
      reply_to: replyTo,
      to: email,
      subject: `You've been paid — ${periodLabel}`,
      html,
    }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { op } = body ?? {};

  // ── SERVER_TIME: the clock the app should trust, not the device's own. ─────
  // A laptop's clock can be wrong (wrong timezone, manually changed, drifted) —
  // the app asks for this once per session and uses the difference from its own
  // Date.now() as a fixed offset for every "official" timestamp it writes
  // afterward (clock-in, pause, resume, clock-out). No auth needed; it reveals
  // nothing but the current time.
  if (op === "server_time") {
    return json({ serverTime: Date.now() });
  }

  // ── LOGIN: trade a PIN for a short-lived session token. ────────────────────
  // Sign in with an employee ID or an email, using either that person's own
  // PIN, or — for anyone with the admin role — the separate Admin PIN too.
  if (op === "login") {
    const { employeeId, email, pin } = body ?? {};
    if ((!employeeId && !email) || !pin) {
      return json({ error: "Missing employeeId/email or pin" }, 400);
    }

    const lockIdentifier = "login:" + String(employeeId ?? email).trim().toLowerCase();
    const lockStatus = await checkLoginLock(admin, lockIdentifier);
    if (lockStatus.locked) {
      const minutes = Math.ceil((lockStatus.retryAfterSeconds ?? 0) / 60);
      return json({ error: `Too many failed attempts. Try again in ${minutes} minute(s).` }, 429);
    }

    let employee: any = null;
    if (employeeId) {
      const { data } = await admin.from("employees").select("*").eq("id", employeeId).maybeSingle();
      employee = data;
    } else {
      const { data } = await admin.from("employees").select("*").ilike("email", String(email).trim()).maybeSingle();
      employee = data;
    }

    if (!employee || employee.active === false) {
      await recordLoginResult(admin, lockIdentifier, false);
      return json({ error: employeeId ? "Employee not found or inactive." : "Email or Employee ID not found. Please check and try again." }, 401);
    }

    const suppliedPin = String(pin).trim().toLowerCase();
    const employeePin = String(employee.pin ?? "").trim().toLowerCase();
    const employeePinMatches = employeePin !== "" && suppliedPin === employeePin;

    let isAdmin = false;
    if (employee.role === "admin" && employeePinMatches) {
      isAdmin = true;
    } else if (!employeePinMatches) {
      const { data: settings } = await admin.from("app_settings").select("admin_pin").limit(1).maybeSingle();
      const adminPin = String(settings?.admin_pin ?? "").trim().toLowerCase();
      if (adminPin && suppliedPin === adminPin) isAdmin = true;
    }

    if (!isAdmin && !employeePinMatches) {
      await recordLoginResult(admin, lockIdentifier, false);
      return json({ error: employeeId || email ? "Invalid employee PIN code." : "Incorrect PIN" }, 401);
    }

    await recordLoginResult(admin, lockIdentifier, true);

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    const { error: sessErr } = await admin
      .from("app_sessions")
      .insert({ token, employee_id: employee.id, is_admin: isAdmin, expires_at: expiresAt });
    if (sessErr) return json({ error: "Could not start session: " + sessErr.message }, 500);

    const supabaseSession = await mintSupabaseSession(admin, employee);
    return json({ token, employee, isAdmin, supabaseSession });
  }

  // ── LOGIN_ADMIN: the Admin PIN alone, not tied to a specific employee. ─────
  // Picks the primary admin employee the same way the app used to.
  if (op === "login_admin") {
    const { pin } = body ?? {};
    if (!pin) return json({ error: "Missing pin" }, 400);

    const lockIdentifier = "login_admin";
    const lockStatus = await checkLoginLock(admin, lockIdentifier);
    if (lockStatus.locked) {
      const minutes = Math.ceil((lockStatus.retryAfterSeconds ?? 0) / 60);
      return json({ error: `Too many failed attempts. Try again in ${minutes} minute(s).` }, 429);
    }

    const { data: settings } = await admin.from("app_settings").select("admin_pin").limit(1).maybeSingle();
    const adminPin = String(settings?.admin_pin ?? "").trim();
    if (!adminPin) return json({ error: "Admin PIN has not been set up yet. Set one in Settings first." }, 401);
    if (String(pin).trim() !== adminPin) {
      await recordLoginResult(admin, lockIdentifier, false);
      return json({ error: "Incorrect Admin PIN. Access denied." }, 401);
    }
    await recordLoginResult(admin, lockIdentifier, true);

    const { data: employees } = await admin.from("employees").select("*").order("id", { ascending: true });
    const adminEmployee = (employees ?? []).find((e: any) => e.role === "admin") ?? (employees ?? [])[0];
    if (!adminEmployee) return json({ error: "No employee accounts exist yet." }, 500);

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    const { error: sessErr } = await admin
      .from("app_sessions")
      .insert({ token, employee_id: adminEmployee.id, is_admin: true, expires_at: expiresAt });
    if (sessErr) return json({ error: "Could not start session: " + sessErr.message }, 500);

    const supabaseSession = await mintSupabaseSession(admin, adminEmployee);
    return json({ token, employee: adminEmployee, isAdmin: true, supabaseSession });
  }

  // ── LOGOUT: drop a session token early. ─────────────────────────────────────
  if (op === "logout") {
    const { token } = body ?? {};
    if (token) await admin.from("app_sessions").delete().eq("token", token);
    return json({ success: true });
  }

  // ── WHOAMI: used on app load to silently restore a session. ─────────────────
  if (op === "whoami") {
    const { token } = body ?? {};
    const session = await lookupSession(admin, token);
    if (!session) return json({ error: "Session expired or invalid" }, 401);
    return json({ employee: session.employee, isAdmin: session.isAdmin });
  }

  // ── CLICKUP_SYNC: pull each team member's open ClickUp tasks in, admin only. ─
  // Matches a ClickUp assignee to a local employee by email, and a ClickUp
  // list name to a local client by name. Anything it can't match still comes
  // in (client left blank) rather than being silently dropped.
  if (op === "clickup_sync") {
    const { token } = body ?? {};
    const session = await lookupSession(admin, token);
    if (!session || !session.isAdmin) return json({ error: "Admin access required" }, 403);

    const clickupKey = Deno.env.get("CLICKUP_API_KEY");
    if (!clickupKey) return json({ error: "ClickUp is not connected yet (missing CLICKUP_API_KEY)." }, 400);

    const cu = async (path: string) => {
      const res = await fetch(`https://api.clickup.com/api/v2${path}`, { headers: { Authorization: clickupKey } });
      if (!res.ok) throw new Error(`ClickUp API error ${res.status}: ${await res.text()}`);
      return res.json();
    };

    try {
      const teams = await cu("/team");
      const teamId = teams?.teams?.[0]?.id;
      if (!teamId) return json({ error: "Could not find a ClickUp workspace for this API key." }, 400);

      const { data: employees } = await admin.from("employees").select("*").eq("active", true);
      const byEmail = new Map<string, any>((employees ?? []).map((e: any) => [String(e.email).trim().toLowerCase(), e]));

      const { data: clients } = await admin.from("clients").select("*");
      const clientByName = new Map<string, any>((clients ?? []).map((c: any) => [String(c.name).trim().toLowerCase(), c]));

      let page = 0;
      let imported = 0;
      let skippedUnassigned = 0;
      const seenIds: string[] = [];
      while (true) {
        const data = await cu(`/team/${teamId}/task?page=${page}&include_closed=false&subtasks=true`);
        const tasks = data?.tasks ?? [];
        for (const t of tasks) {
          const assignee = (t.assignees ?? [])
            .map((a: any) => byEmail.get(String(a.email ?? "").trim().toLowerCase()))
            .find((e: any) => e);
          if (!assignee) {
            skippedUnassigned++;
            continue;
          }
          const client = clientByName.get(String(t.list?.name ?? "").trim().toLowerCase());
          const now = Date.now();
          const row = {
            id: `clickup_${t.id}`,
            employee_id: assignee.id,
            client_id: client?.id ?? null,
            client_name: client?.name ?? t.list?.name ?? null,
            title: t.name,
            status: "todo",
            source: "clickup",
            clickup_task_id: t.id,
            clickup_list_id: t.list?.id ?? null,
            clickup_url: t.url,
            due_date: t.due_date ? Number(t.due_date) : null,
            created_at: now,
            updated_at: now,
          };
          seenIds.push(row.id);
          // Don't overwrite a task's status/updated_at once a team member has started it —
          // only fill in fields that could have changed on ClickUp's side.
          const { data: existing } = await admin.from("tasks").select("id, status").eq("id", row.id).maybeSingle();
          if (existing) {
            await admin.from("tasks").update({
              title: row.title, client_id: row.client_id, client_name: row.client_name,
              due_date: row.due_date, clickup_url: row.clickup_url, clickup_list_id: row.clickup_list_id,
            }).eq("id", row.id);
          } else {
            await admin.from("tasks").insert(row);
          }
          imported++;
        }
        if (!tasks.length || data?.last_page === true) break;
        page++;
        if (page > 20) break; // safety stop
      }

      // A task closed/deleted on ClickUp's side shouldn't linger on someone's to-do list forever.
      let removedStale = 0;
      if (seenIds.length) {
        const { count } = await admin
          .from("tasks")
          .delete({ count: "exact" })
          .eq("source", "clickup")
          .not("id", "in", `(${seenIds.map((id) => `"${id}"`).join(",")})`);
        removedStale = count ?? 0;
      }

      return json({ imported, skippedUnassigned, removedStale });
    } catch (e) {
      return json({ error: "ClickUp sync failed: " + String((e as Error).message ?? e) }, 500);
    }
  }

  // ── CLOCK_IN_BOOTSTRAP: the four reads clockIn() needs, in one round trip
  // instead of four separate requests — this is what made "Start Tracking"
  // feel slow, especially on a cold Edge Function start.
  if (op === "clock_in_bootstrap") {
    const { token: bToken, employeeId: bEmployeeId } = body ?? {};
    if (!bToken) return json({ error: "Missing token" }, 400);
    const bSession = await lookupSession(admin, bToken);
    if (!bSession) return json({ error: "Session expired or invalid" }, 401);

    const [existing, contracts, settings, permissions] = await Promise.all([
      admin.from("time_entries").select("*").eq("employee_id", bEmployeeId ?? bSession.employeeId)
        .in("status", ["active", "paused"]).limit(1).maybeSingle(),
      admin.from("contracts").select("*"),
      admin.from("app_settings").select("*"),
      admin.from("team_permissions").select("*"),
    ]);
    return json({
      existing: existing.data ?? null,
      contracts: contracts.data ?? [],
      settings: settings.data ?? [],
      permissions: permissions.data ?? [],
    });
  }

  // ── Everything else needs a valid session token. ────────────────────────────
  const { token, table, filter, values, id } = body ?? {};
  if (!token || !table || !op) {
    return json({ error: "Missing token, table, or op" }, 400);
  }

  const session = await lookupSession(admin, token);
  if (!session) return json({ error: "Session expired or invalid" }, 401);
  const { employeeId, isAdmin } = session;

  // ── What is this table/op combination allowed to do? ────────────────────────
  const scopedWriteColumn = EMPLOYEE_WRITE_SCOPED[table];
  const scopedReadColumn = EMPLOYEE_READ_SCOPED[table];
  const isReadableRef = EMPLOYEE_READABLE.includes(table);

  if (op === "select") {
    if (!isAdmin && !scopedReadColumn && !isReadableRef && table !== "employees") {
      return json({ error: `Not allowed to read "${table}"` }, 403);
    }
  } else if (op === "upsert") {
    if (ADMIN_ONLY_WRITE.includes(table) && !isAdmin && !scopedWriteColumn) {
      return json({ error: `Admin access required to write "${table}"` }, 403);
    }
    if (!isAdmin && !scopedWriteColumn) {
      return json({ error: `Not allowed to write "${table}"` }, 403);
    }
  } else if (op === "delete") {
    if (!isAdmin && table === "employees") {
      return json({ error: "Admin access required to delete an employee" }, 403);
    }
    if (ADMIN_ONLY_WRITE.includes(table) && !isAdmin && !scopedWriteColumn) {
      return json({ error: `Admin access required to write "${table}"` }, 403);
    }
    if (!isAdmin && !scopedWriteColumn) {
      return json({ error: `Not allowed to write "${table}"` }, 403);
    }
  } else {
    return json({ error: "Unknown op" }, 400);
  }

  // ── Force scoping for a non-admin, no matter what the request said. ────────
  let effectiveFilter: Record<string, unknown> = { ...(filter ?? {}) };
  let effectiveValues = values;

  if (!isAdmin && op === "select" && scopedReadColumn) {
    effectiveFilter[scopedReadColumn] = employeeId;
  }
  if (!isAdmin && (op === "upsert" || op === "delete") && scopedWriteColumn) {
    effectiveFilter[scopedWriteColumn] = employeeId;
    const forceOwn = (row: Record<string, unknown>) => {
      row[scopedWriteColumn] = employeeId;
      if (table === "timesheet_approvals" && "status" in row) row.status = "submitted";
      // A team member can add their own time entry, but a self-added one
      // (id starts with "selfmanual_") always goes in awaiting sign-off —
      // never approved, no matter what the request said.
      if (table === "time_entries" && typeof row.id === "string" && row.id.startsWith("selfmanual_")) {
        row.approval_status = "pending";
      }
    };
    if (Array.isArray(effectiveValues)) effectiveValues.forEach(forceOwn);
    else if (effectiveValues && typeof effectiveValues === "object") forceOwn(effectiveValues);

    // A non-admin editing their own "employees" row (e.g. changing their PIN)
    // may only ever change the fields listed above. Everything else in the
    // request is discarded and replaced with what's already in the database.
    if (table === "employees" && op === "upsert" && effectiveValues && !Array.isArray(effectiveValues)) {
      const { data: existing } = await admin.from("employees").select("*").eq("id", employeeId).maybeSingle();
      if (existing) {
        const restored: Record<string, unknown> = { ...existing };
        for (const f of EMPLOYEE_SELF_EDITABLE_FIELDS) {
          if (f in effectiveValues) restored[f] = (effectiveValues as any)[f];
        }
        effectiveValues = restored;
      }
    }

    // Same carve-out for "tasks": a team member may only flip status on a task
    // that's already theirs — never create one, reassign it, or edit anything else.
    if (table === "tasks" && op === "upsert" && effectiveValues && !Array.isArray(effectiveValues)) {
      const taskId = (effectiveValues as any).id;
      const { data: existing } = await admin.from("tasks").select("*").eq("id", taskId).eq("employee_id", employeeId).maybeSingle();
      if (!existing) return json({ error: "Not allowed to create or reassign tasks" }, 403);
      const restored: Record<string, unknown> = { ...existing };
      for (const f of TASK_SELF_EDITABLE_FIELDS) {
        if (f in effectiveValues) restored[f] = (effectiveValues as any)[f];
      }
      restored.updated_at = Date.now();
      effectiveValues = restored;
    }
  }
  if (!isAdmin && table === "employees" && op === "select") {
    effectiveFilter["id"] = employeeId;
  }

  // ── Run it, with the real (service-role) client. ────────────────────────────
  try {
    if (op === "select") {
      // Supabase caps a single request at 1000 rows. A whole-company select
      // (e.g. admin fetching every time entry) can easily exceed that, and
      // the cut-off rows would silently vanish from the app with no error —
      // so page through with .range() until a page comes back short.
      const PAGE_SIZE = 1000;
      let allRows: any[] = [];
      let page = 0;
      while (true) {
        let q = admin.from(table).select("*").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        for (const [k, v] of Object.entries(effectiveFilter)) q = q.eq(k, v as any);
        const { data, error } = await q;
        if (error) throw error;
        allRows = allRows.concat(data ?? []);
        if (!data || data.length < PAGE_SIZE) break;
        page++;
      }
      return json({ data: allRows });
    }

    if (op === "upsert") {
      if (!effectiveValues) return json({ error: "Missing values" }, 400);
      if (!isAdmin && scopedWriteColumn && id) {
        const { data: existing } = await admin.from(table).select(scopedWriteColumn).eq("id", id).maybeSingle();
        if (existing && (existing as any)[scopedWriteColumn] !== employeeId) {
          return json({ error: "That record does not belong to you" }, 403);
        }
      }
      const { data, error } = await admin.from(table).upsert(effectiveValues).select();
      if (error) throw error;

      // Status changed on a ClickUp-sourced task — reflect it back on ClickUp too,
      // so the two stay in sync instead of only pulling one way.
      if (table === "tasks" && data?.[0]?.source === "clickup" && data[0].clickup_task_id && "status" in (effectiveValues as any)) {
        const pushPromise = pushTaskStatusToClickUp(data[0].clickup_task_id, data[0].clickup_list_id, data[0].status).catch(() => {});
        // Without this, the function can return (and the isolate can be torn down) before
        // this fetch actually completes — EdgeRuntime.waitUntil keeps it alive until it's done.
        const rt = (globalThis as any).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(pushPromise);
        else await pushPromise;
      }

      // A payout was just recorded (Mark Paid) — let that person know by email.
      // Never blocks or fails the actual payout save; a missing/broken key just
      // means no email goes out, the payout itself is unaffected either way.
      if (table === "payouts" && data?.[0]) {
        const emailPromise = sendPayoutEmail(admin, data[0]).catch(() => {});
        const rt2 = (globalThis as any).EdgeRuntime;
        if (rt2?.waitUntil) rt2.waitUntil(emailPromise);
        else await emailPromise;
      }

      return json({ data });
    }

    if (op === "delete") {
      if (!id) return json({ error: "Missing id" }, 400);
      let q = admin.from(table).delete().eq("id", id);
      for (const [k, v] of Object.entries(effectiveFilter)) q = q.eq(k, v as any);
      const { error } = await q;
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: "Unknown op" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

async function lookupSession(
  admin: ReturnType<typeof createClient>,
  token: string | undefined
): Promise<{ employeeId: string; isAdmin: boolean; employee: any } | null> {
  if (!token) return null;
  const { data: session } = await admin
    .from("app_sessions")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;

  const msLeft = new Date(session.expires_at).getTime() - Date.now();
  if (msLeft < (SESSION_HOURS * 3600 - 1800) * 1000) {
    const newExpiry = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    await admin.from("app_sessions").update({ expires_at: newExpiry }).eq("token", token);
  }

  const { data: employee } = await admin.from("employees").select("*").eq("id", session.employee_id).maybeSingle();
  if (!employee || employee.active === false) return null;

  return { employeeId: session.employee_id, isAdmin: session.is_admin, employee };
}
