import { Injectable } from '@angular/core';
import { getSupabaseClient } from '../supabase.config';
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
// All data lives in Supabase. Every read and write goes straight to the
// database — nothing is cached on the device, so there is nothing to sync.
// Table columns are snake_case (see supabase_schema.sql).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  screenshotIntervalMinutes: 10,
  adminPin: 'admin123',
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

@Injectable({ providedIn: 'root' })
export class DataService {
  /** id of the single app_settings row, once it has been read */
  private settingsId: string | null = null;

  private get supabase() {
    return getSupabaseClient();
  }

  /** Throw a readable error when Supabase rejects a request. */
  private check(error: { message: string } | null, what: string): void {
    if (error) throw new Error(`Could not ${what}: ${error.message}`);
  }

  private async selectAll(table: string): Promise<Row[]> {
    const { data, error } = await this.supabase.from(table).select('*');
    this.check(error, `load ${table}`);
    return data ?? [];
  }

  private async upsert(table: string, rows: Row | Row[]): Promise<void> {
    const { error } = await this.supabase.from(table).upsert(rows);
    this.check(error, `save to ${table}`);
  }

  private async deleteWhere(table: string, column: string, value: string): Promise<void> {
    const { error } = await this.supabase.from(table).delete().eq(column, value);
    this.check(error, `delete from ${table}`);
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  async getEmployees(): Promise<Employee[]> {
    return (await this.selectAll('employees')).map(toEmployee);
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    const { data, error } = await this.supabase.from('employees').select('*').eq('id', id).maybeSingle();
    this.check(error, 'load employee');
    return data ? toEmployee(data) : null;
  }

  async saveEmployee(employee: Employee): Promise<void> {
    await this.upsert('employees', fromEmployee(employee));
  }

  async deleteEmployee(id: string): Promise<void> {
    await this.deleteWhere('employees', 'id', id);
  }

  // ── Clients ───────────────────────────────────────────────────────────────

  async getClients(): Promise<Client[]> {
    return (await this.selectAll('clients')).map(toClient);
  }

  async saveClient(client: Client): Promise<void> {
    await this.upsert('clients', fromClient(client));
  }

  async deleteClient(id: string): Promise<void> {
    await this.deleteWhere('clients', 'id', id);
  }

  // ── Time Entries ──────────────────────────────────────────────────────────

  async getTimeEntries(): Promise<TimeEntry[]> {
    const { data, error } = await this.supabase
      .from('time_entries')
      .select('*')
      .order('start_time', { ascending: false });
    this.check(error, 'load time entries');
    return (data ?? []).map(toTimeEntry);
  }

  async getActiveTimeEntry(employeeId?: string): Promise<TimeEntry | null> {
    let query = this.supabase.from('time_entries').select('*').in('status', ['active', 'paused']);
    if (employeeId) query = query.eq('employee_id', employeeId);
    const { data, error } = await query.order('start_time', { ascending: false }).limit(1).maybeSingle();
    this.check(error, 'load running timer');
    return data ? toTimeEntry(data) : null;
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    const { data, error } = await this.supabase.from('time_entries').select('*').eq('id', id).maybeSingle();
    this.check(error, 'load time entry');
    return data ? toTimeEntry(data) : null;
  }

  async saveTimeEntry(entry: TimeEntry): Promise<void> {
    await this.upsert('time_entries', fromTimeEntry(entry));
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this.deleteWhere('screenshots', 'time_entry_id', id);
    await this.deleteWhere('time_entries', 'id', id);
  }

  // ── Contracts (pay & bill rate per member per client) ─────────────────────

  async getContracts(): Promise<Contract[]> {
    return (await this.selectAll('contracts')).map(toContract);
  }

  async saveContract(contract: Contract): Promise<void> {
    await this.upsert('contracts', fromContract(contract));
  }

  async deleteContract(id: string): Promise<void> {
    await this.deleteWhere('contracts', 'id', id);
  }

  /** True when every table the app needs exists in Supabase. */
  async cloudTablesReady(): Promise<boolean> {
    try {
      const results = await Promise.all(
        ['contracts', 'payouts', 'timesheet_approvals', 'team_permissions'].map((t) =>
          this.supabase.from(t).select('id').limit(1)
        )
      );
      return results.every((r) => !r.error);
    } catch {
      return false;
    }
  }

  // ── Payouts (who was paid for which pay period) ──────────────────────────

  async getPayouts(): Promise<Payout[]> {
    return (await this.selectAll('payouts')).map(toPayout);
  }

  async savePayout(payout: Payout): Promise<void> {
    await this.upsert('payouts', fromPayout(payout));
  }

  async deletePayout(id: string): Promise<void> {
    await this.deleteWhere('payouts', 'id', id);
  }

  // ── Timesheet approvals (submit → approve per pay period) ────────────────

  async getApprovals(): Promise<TimesheetApproval[]> {
    return (await this.selectAll('timesheet_approvals')).map(toApproval);
  }

  async saveApproval(approval: TimesheetApproval): Promise<void> {
    await this.upsert('timesheet_approvals', fromApproval(approval));
  }

  // ── Team access (what team members can see and do) ──────────────────────

  async getPermissions(): Promise<TeamPermissionRow[]> {
    return (await this.selectAll('team_permissions')).map((r) => ({
      id: String(r['id']),
      permissions: r['permissions'] ?? {},
    }));
  }

  async savePermission(row: TeamPermissionRow): Promise<void> {
    await this.upsert('team_permissions', { id: row.id, permissions: row.permissions });
  }

  async deletePermission(id: string): Promise<void> {
    await this.deleteWhere('team_permissions', 'id', id);
  }

  // ── Screenshots ───────────────────────────────────────────────────────────

  async getScreenshots(timeEntryId?: string): Promise<ScreenshotRecord[]> {
    let query = this.supabase.from('screenshots').select('*');
    if (timeEntryId) query = query.eq('time_entry_id', timeEntryId);
    const { data, error } = await query.order('timestamp', { ascending: false });
    this.check(error, 'load screenshots');
    return (data ?? []).map(toScreenshot);
  }

  async saveScreenshot(record: ScreenshotRecord): Promise<void> {
    await this.upsert('screenshots', fromScreenshot(record));
  }

  async deleteScreenshot(id: string): Promise<void> {
    await this.deleteWhere('screenshots', 'id', id);
  }

  // ── Settings (a single row in app_settings) ──────────────────────────────

  async getSettings(): Promise<AppSettings> {
    const { data, error } = await this.supabase.from('app_settings').select('*').limit(1).maybeSingle();
    this.check(error, 'load settings');
    if (!data) return { ...DEFAULT_SETTINGS };
    this.settingsId = String(data['id']);
    return toSettings(data);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    if (!this.settingsId) await this.getSettings();
    await this.upsert('app_settings', { id: this.settingsId ?? 'appSettings', ...fromSettings(settings) });
  }

  // ── Export / Import ───────────────────────────────────────────────────────

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
      if (rows.length) await this.upsert(table, rows);
    }

    if (data.settings) {
      await this.saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    }
  }
}
