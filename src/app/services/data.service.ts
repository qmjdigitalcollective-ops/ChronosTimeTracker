import { Injectable } from '@angular/core';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../supabase.config';
import {
  Employee,
  Client,
  TimeEntry,
  ScreenshotRecord,
  AppSettings,
  UserRole,
  Contract,
  Payout,
  TimesheetApproval,
  TeamPermissionRow,
} from '../models/time-tracker.models';

// ─────────────────────────────────────────────────────────────────────────────
// The app no longer talks to Supabase directly. Every read and write goes
// through the "gate" Edge Function, which checks a login token (or, only for
// signing in, a PIN) against the real database using a key that never
// reaches the browser, and only then performs the operation.
//
// Sign-in methods (login/loginAdmin/whoami/logout) live here too, since they
// use the exact same gate — AuthService just calls into this service and
// never talks to the network itself.
//
// Table columns are snake_case (see supabase_schema.sql).
// ─────────────────────────────────────────────────────────────────────────────

const GATE_URL = `${SUPABASE_URL}/functions/v1/gate`;
const TOKEN_KEY = 'timetracker_gate_token';

const DEFAULT_SETTINGS: AppSettings = {
  screenshotIntervalMinutes: 10,
  // Deliberately blank, not a guessable default like 'admin123' — an admin
  // must set a real PIN in Settings before Admin sign-in will work.
  adminPin: '',
  allowMockScreenshotsIfDenied: true,
};

type Row = Record<string, any>;

const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));
const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));

// ── Row ⇄ model mapping ─────────────────────────────────────────────────────

function toEmployee(r: Row): Employee {
  return {
    id: String(r['id']),
    name: String(r['name'] ?? ''),
    email: String(r['email'] ?? ''),
    role: (r['role'] || 'user') as UserRole,
    hourlyRate: Number(r['hourly_rate'] ?? 0),
    pin: str(r['pin']),
    department: str(r['department']),
    avatarColor: String(r['avatar_color'] || '#3b82f6'),
    active: r['active'] !== false,
  };
}

function fromEmployee(e: Employee): Row {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    role: e.role,
    hourly_rate: e.hourlyRate,
    pin: e.pin ?? null,
    department: e.department ?? null,
    avatar_color: e.avatarColor ?? null,
    active: e.active,
  };
}

function toClient(r: Row): Client {
  return {
    id: String(r['id']),
    name: String(r['name'] ?? ''),
    code: String(r['code'] ?? ''),
    defaultRate: num(r['default_rate']),
    color: str(r['color']),
    active: r['active'] !== false,
  };
}

function fromClient(c: Client): Row {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    default_rate: c.defaultRate ?? null,
    color: c.color ?? null,
    active: c.active,
  };
}

function toTimeEntry(r: Row): TimeEntry {
  return {
    id: String(r['id']),
    employeeId: String(r['employee_id'] ?? ''),
    employeeName: String(r['employee_name'] ?? ''),
    clientId: String(r['client_id'] ?? ''),
    clientName: String(r['client_name'] ?? ''),
    taskDescription: String(r['task_description'] ?? ''),
    startTime: Number(r['start_time'] ?? 0),
    endTime: num(r['end_time']),
    durationSeconds: Number(r['duration_seconds'] ?? 0),
    pausedSeconds: Number(r['paused_seconds'] ?? 0),
    status: (r['status'] || 'completed') as TimeEntry['status'],
    hourlyRate: Number(r['hourly_rate'] ?? 0),
    totalPay: Number(r['total_pay'] ?? 0),
    screenshotCount: Number(r['screenshot_count'] ?? 0),
    lastPauseTime: num(r['last_pause_time']),
  };
}

function fromTimeEntry(e: TimeEntry): Row {
  return {
    id: e.id,
    employee_id: e.employeeId,
    employee_name: e.employeeName,
    client_id: e.clientId,
    client_name: e.clientName,
    task_description: e.taskDescription,
    start_time: e.startTime,
    // Explicit nulls so clearing a value (e.g. lastPauseTime on resume) reaches the database
    end_time: e.endTime ?? null,
    duration_seconds: Math.round(e.durationSeconds),
    paused_seconds: Math.round(e.pausedSeconds),
    status: e.status,
    hourly_rate: e.hourlyRate,
    total_pay: e.totalPay,
    screenshot_count: e.screenshotCount,
    last_pause_time: e.lastPauseTime ?? null,
  };
}

function toScreenshot(r: Row): ScreenshotRecord {
  return {
    id: String(r['id']),
    timeEntryId: String(r['time_entry_id'] ?? ''),
    employeeId: String(r['employee_id'] ?? ''),
    employeeName: String(r['employee_name'] ?? ''),
    timestamp: Number(r['timestamp'] ?? 0),
    imageDataUrl: String(r['image_data_url'] ?? ''),
    thumbnailDataUrl: str(r['thumbnail_data_url']),
    driveFileId: str(r['drive_file_id']),
    driveViewUrl: str(r['drive_view_url']),
  };
}

function fromScreenshot(s: ScreenshotRecord): Row {
  return {
    id: s.id,
    time_entry_id: s.timeEntryId,
    employee_id: s.employeeId,
    employee_name: s.employeeName,
    timestamp: s.timestamp,
    image_data_url: s.imageDataUrl,
    thumbnail_data_url: s.thumbnailDataUrl ?? null,
    drive_file_id: s.driveFileId ?? null,
    drive_view_url: s.driveViewUrl ?? null,
  };
}

function toSettings(r: Row): AppSettings {
  return {
    screenshotIntervalMinutes: Number(r['screenshot_interval_minutes'] ?? DEFAULT_SETTINGS.screenshotIntervalMinutes),
    adminPin: String(r['admin_pin'] ?? DEFAULT_SETTINGS.adminPin),
    activeEmployeeId: str(r['active_employee_id']),
    activeRole: (r['active_role'] ?? undefined) as UserRole | undefined,
    allowMockScreenshotsIfDenied: r['allow_mock_screenshots_if_denied'] !== false,
  };
}

function fromSettings(s: AppSettings): Row {
  return {
    screenshot_interval_minutes: s.screenshotIntervalMinutes,
    admin_pin: s.adminPin,
    active_employee_id: s.activeEmployeeId ?? null,
    active_role: s.activeRole ?? null,
    allow_mock_screenshots_if_denied: s.allowMockScreenshotsIfDenied,
  };
}

function toContract(r: Row): Contract {
  return {
    id: String(r['id']),
    employeeId: String(r['employee_id'] ?? ''),
    clientId: String(r['client_id'] ?? ''),
    payRate: Number(r['pay_rate'] ?? 0),
    billRate: Number(r['bill_rate'] ?? 0),
    weeklyLimitHours: num(r['weekly_limit_hours']),
    active: r['active'] !== false,
  };
}

function fromContract(c: Contract): Row {
  return {
    id: c.id,
    employee_id: c.employeeId,
    client_id: c.clientId,
    pay_rate: c.payRate,
    bill_rate: c.billRate,
    weekly_limit_hours: c.weeklyLimitHours ?? null,
    active: c.active,
  };
}

function toPayout(r: Row): Payout {
  return {
    id: String(r['id']),
    employeeId: String(r['employee_id'] ?? ''),
    employeeName: String(r['employee_name'] ?? ''),
    periodStart: Number(r['period_start'] ?? 0),
    periodEnd: Number(r['period_end'] ?? 0),
    hours: Number(r['hours'] ?? 0),
    amount: Number(r['amount'] ?? 0),
    paidAt: Number(r['paid_at'] ?? 0),
    note: str(r['note']),
  };
}

function fromPayout(p: Payout): Row {
  return {
    id: p.id,
    employee_id: p.employeeId,
    employee_name: p.employeeName,
    period_start: p.periodStart,
    period_end: p.periodEnd,
    hours: p.hours,
    amount: p.amount,
    paid_at: p.paidAt,
    note: p.note ?? null,
  };
}

function toApproval(r: Row): TimesheetApproval {
  return {
    id: String(r['id']),
    employeeId: String(r['employee_id'] ?? ''),
    employeeName: String(r['employee_name'] ?? ''),
    periodStart: Number(r['period_start'] ?? 0),
    periodEnd: Number(r['period_end'] ?? 0),
    status: r['status'] as TimesheetApproval['status'],
    hours: Number(r['hours'] ?? 0),
    submittedAt: Number(r['submitted_at'] ?? 0),
    reviewedAt: num(r['reviewed_at']),
    note: str(r['note']),
  };
}

function fromApproval(a: TimesheetApproval): Row {
  return {
    id: a.id,
    employee_id: a.employeeId,
    employee_name: a.employeeName,
    period_start: a.periodStart,
    period_end: a.periodEnd,
    status: a.status,
    hours: a.hours,
    submitted_at: a.submittedAt,
    reviewed_at: a.reviewedAt ?? null,
    note: a.note ?? null,
  };
}

export interface LoginResult {
  employee: Employee;
  isAdmin: boolean;
}

@Injectable({ providedIn: 'root' })
export class DataService {
  /** id of the single app_settings row, once it has been read */
  private settingsId: string | null = null;

  // ── Token (session) storage ────────────────────────────────────────────────

  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private setToken(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }

  // ── The one call every request goes through ───────────────────────────────

  private async call(body: Record<string, unknown>): Promise<any> {
    let res: Response;
    try {
      res = await fetch(GATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not reach the server. Check your internet connection and try again.');
    }
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* fall through to the generic error below */
    }
    if (!res.ok || json?.error) {
      throw new Error(json?.error || `Request failed (${res.status})`);
    }
    return json;
  }

  private async select(table: string, filter?: Record<string, unknown>): Promise<Row[]> {
    const res = await this.call({ op: 'select', token: this.getToken(), table, filter });
    return res.data ?? [];
  }

  private async selectOne(table: string, filter: Record<string, unknown>): Promise<Row | null> {
    const rows = await this.select(table, filter);
    return rows[0] ?? null;
  }

  private async upsertRow(table: string, values: Row | Row[], id?: string): Promise<Row[]> {
    const res = await this.call({ op: 'upsert', token: this.getToken(), table, values, id });
    return res.data ?? [];
  }

  private async deleteRow(table: string, id: string, filter?: Record<string, unknown>): Promise<void> {
    await this.call({ op: 'delete', token: this.getToken(), table, id, filter });
  }

  // ── Sign in / out ─────────────────────────────────────────────────────────
  // These are the only calls that don't need an existing token.

  async login(opts: { employeeId?: string; email?: string; pin: string }): Promise<LoginResult> {
    const res = await this.call({ op: 'login', ...opts });
    this.setToken(res.token);
    return { employee: toEmployee(res.employee), isAdmin: !!res.isAdmin };
  }

  async loginAdmin(pin: string): Promise<LoginResult> {
    const res = await this.call({ op: 'login_admin', pin });
    this.setToken(res.token);
    return { employee: toEmployee(res.employee), isAdmin: !!res.isAdmin };
  }

  /** Silently restores a session from a stored token, if it's still valid. Never throws. */
  async whoami(): Promise<LoginResult | null> {
    const token = this.getToken();
    if (!token) return null;
    try {
      const res = await this.call({ op: 'whoami', token });
      return { employee: toEmployee(res.employee), isAdmin: !!res.isAdmin };
    } catch {
      this.setToken(null);
      return null;
    }
  }

  async logout(): Promise<void> {
    const token = this.getToken();
    this.setToken(null);
    if (token) {
      try {
        await this.call({ op: 'logout', token });
      } catch {
        /* the token is dropped locally either way */
      }
    }
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  async getEmployees(): Promise<Employee[]> {
    return (await this.select('employees')).map(toEmployee);
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    const row = await this.selectOne('employees', { id });
    return row ? toEmployee(row) : null;
  }

  async saveEmployee(employee: Employee): Promise<void> {
    await this.upsertRow('employees', fromEmployee(employee), employee.id);
  }

  async deleteEmployee(id: string): Promise<void> {
    await this.deleteRow('employees', id);
  }

  // ── Clients ───────────────────────────────────────────────────────────────

  async getClients(): Promise<Client[]> {
    return (await this.select('clients')).map(toClient);
  }

  async saveClient(client: Client): Promise<void> {
    await this.upsertRow('clients', fromClient(client), client.id);
  }

  async deleteClient(id: string): Promise<void> {
    await this.deleteRow('clients', id);
  }

  // ── Time Entries ──────────────────────────────────────────────────────────

  /** Newest first. Narrow it down so the server only sends what the page needs. */
  async getTimeEntries(filter: { employeeId?: string; since?: number } = {}): Promise<TimeEntry[]> {
    const serverFilter: Record<string, unknown> = {};
    if (filter.employeeId) serverFilter['employee_id'] = filter.employeeId;
    // "since" is a range, not an equality match — the gate applies equality filters only,
    // so entries are fetched by employee (or in full, for an admin) and trimmed here.
    const rows = await this.select('time_entries', serverFilter);
    let entries = rows.map(toTimeEntry);
    if (filter.since != null) entries = entries.filter((e) => e.startTime >= filter.since!);
    return entries.sort((a, b) => b.startTime - a.startTime);
  }

  async getActiveTimeEntry(employeeId?: string): Promise<TimeEntry | null> {
    const filter: Record<string, unknown> = {};
    if (employeeId) filter['employee_id'] = employeeId;
    const rows = (await this.select('time_entries', filter)).filter((r) => r['status'] === 'active' || r['status'] === 'paused');
    if (!rows.length) return null;
    rows.sort((a, b) => Number(b['start_time'] ?? 0) - Number(a['start_time'] ?? 0));
    return toTimeEntry(rows[0]);
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    const row = await this.selectOne('time_entries', { id });
    return row ? toTimeEntry(row) : null;
  }

  async saveTimeEntry(entry: TimeEntry): Promise<void> {
    await this.upsertRow('time_entries', fromTimeEntry(entry), entry.id);
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this.deleteRow('screenshots', '', { time_entry_id: id });
    await this.deleteRow('time_entries', id);
  }

  // ── Contracts (pay & bill rate per member per client) ─────────────────────

  async getContracts(): Promise<Contract[]> {
    return (await this.select('contracts')).map(toContract);
  }

  async saveContract(contract: Contract): Promise<void> {
    await this.upsertRow('contracts', fromContract(contract), contract.id);
  }

  async deleteContract(id: string): Promise<void> {
    await this.deleteRow('contracts', id);
  }

  /** True when every table the app needs exists in Supabase. */
  async cloudTablesReady(): Promise<boolean> {
    try {
      await Promise.all(
        ['contracts', 'payouts', 'timesheet_approvals', 'team_permissions'].map((t) => this.select(t))
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Payouts (who was paid for which pay period) ──────────────────────────

  async getPayouts(): Promise<Payout[]> {
    return (await this.select('payouts')).map(toPayout);
  }

  async savePayout(payout: Payout): Promise<void> {
    await this.upsertRow('payouts', fromPayout(payout), payout.id);
  }

  async deletePayout(id: string): Promise<void> {
    await this.deleteRow('payouts', id);
  }

  // ── Timesheet approvals (submit → approve per pay period) ────────────────

  async getApprovals(): Promise<TimesheetApproval[]> {
    return (await this.select('timesheet_approvals')).map(toApproval);
  }

  async saveApproval(approval: TimesheetApproval): Promise<void> {
    await this.upsertRow('timesheet_approvals', fromApproval(approval), approval.id);
  }

  // ── Team access (what team members can see and do) ──────────────────────

  async getPermissions(): Promise<TeamPermissionRow[]> {
    return (await this.select('team_permissions')).map((r) => ({
      id: String(r['id']),
      permissions: r['permissions'] ?? {},
    }));
  }

  async savePermission(row: TeamPermissionRow): Promise<void> {
    await this.upsertRow('team_permissions', { id: row.id, permissions: row.permissions }, row.id);
  }

  async deletePermission(id: string): Promise<void> {
    await this.deleteRow('team_permissions', id);
  }

  // ── Screenshots ───────────────────────────────────────────────────────────

  async getScreenshots(timeEntryId?: string): Promise<ScreenshotRecord[]> {
    const filter: Record<string, unknown> = {};
    if (timeEntryId) filter['time_entry_id'] = timeEntryId;
    const rows = await this.select('screenshots', filter);
    return rows.map(toScreenshot).sort((a, b) => b.timestamp - a.timestamp);
  }

  async saveScreenshot(record: ScreenshotRecord): Promise<void> {
    await this.upsertRow('screenshots', fromScreenshot(record), record.id);
  }

  async deleteScreenshot(id: string): Promise<void> {
    await this.deleteRow('screenshots', id);
  }

  // ── Settings (a single row in app_settings) ──────────────────────────────

  async getSettings(): Promise<AppSettings> {
    const row = await this.selectOne('app_settings', {});
    if (!row) return { ...DEFAULT_SETTINGS };
    this.settingsId = String(row['id']);
    return toSettings(row);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    if (!this.settingsId) await this.getSettings();
    const id = this.settingsId ?? 'appSettings';
    await this.upsertRow('app_settings', { id, ...fromSettings(settings) }, id);
  }

  // ── Export / Import (admin only) ──────────────────────────────────────────

  async exportAllData(): Promise<string> {
    const [employees, clients, timeEntries, screenshots, settings, contracts, payouts] = await Promise.all([
      this.getEmployees(),
      this.getClients(),
      this.getTimeEntries(),
      this.getScreenshots(),
      this.getSettings(),
      this.getContracts(),
      this.getPayouts(),
    ]);

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        version: 2,
        employees,
        clients,
        contracts,
        payouts,
        timeEntries,
        screenshots,
        settings,
      },
      null,
      2
    );
  }

  async importData(jsonString: string): Promise<void> {
    const data = JSON.parse(jsonString);

    const toArray = <T>(val: unknown): T[] => {
      if (Array.isArray(val)) return val;
      if (val && typeof val === 'object') return Object.values(val) as T[];
      return [];
    };

    const batches: [string, Row[]][] = [
      ['employees', toArray<Employee>(data.employees).map(fromEmployee)],
      ['clients', toArray<Client>(data.clients).map(fromClient)],
      ['contracts', toArray<Contract>(data.contracts).map(fromContract)],
      ['payouts', toArray<Payout>(data.payouts).map(fromPayout)],
      ['time_entries', toArray<TimeEntry>(data.timeEntries || data.time_entries).map(fromTimeEntry)],
      ['screenshots', toArray<ScreenshotRecord>(data.screenshots || data.screenshot_records).map(fromScreenshot)],
    ];
    for (const [table, rows] of batches) {
      if (rows.length) await this.upsertRow(table, rows);
    }

    if (data.settings) {
      await this.saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    }
  }
}
