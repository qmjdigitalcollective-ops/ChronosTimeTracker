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

// ── Default seed data ────────────────────────────────────────────────────────

const DEFAULT_EMPLOYEES: Employee[] = [
  {
    id: 'emp-1',
    name: 'Queen (Owner)',
    email: 'qmjdigitalcollective@gmail.com',
    role: 'admin',
    hourlyRate: 0,
    department: 'Owner',
    avatarColor: '#063c35',
    pin: 'queen23', // starting PIN: first name + 23 (must be changed on first sign-in)
    active: true,
  },
  {
    id: 'emp-2',
    name: 'John Doe (Developer)',
    email: 'john.doe@example.com',
    role: 'user',
    hourlyRate: 35.0,
    department: 'Engineering',
    avatarColor: '#0ea5e9',
    pin: '1234',
    active: true,
  },
  {
    id: 'emp-3',
    name: 'Jane Smith (UI Designer)',
    email: 'jane.smith@example.com',
    role: 'user',
    hourlyRate: 40.0,
    department: 'Product Design',
    avatarColor: '#ec4899',
    pin: '1234',
    active: true,
  },
  {
    id: 'emp-4',
    name: 'Alex Rivera (QA Tester)',
    email: 'alex.rivera@example.com',
    role: 'user',
    hourlyRate: 30.0,
    department: 'Quality Assurance',
    avatarColor: '#10b981',
    pin: '1234',
    active: true,
  },
];

const DEFAULT_CLIENTS: Client[] = [
  { id: 'cli-1', name: 'Acme Corporation', code: 'ACM', defaultRate: 50, color: '#3b82f6', active: true },
  { id: 'cli-2', name: 'Stark Global', code: 'STK', defaultRate: 65, color: '#ef4444', active: true },
  { id: 'cli-3', name: 'Wayne Enterprises', code: 'WYN', defaultRate: 75, color: '#10b981', active: true },
  { id: 'cli-4', name: 'Cyberdyne Systems', code: 'CYB', defaultRate: 45, color: '#8b5cf6', active: true },
];

const DEFAULT_SETTINGS: AppSettings = {
  screenshotIntervalMinutes: 10,
  autoSync: true,
  adminPin: 'admin123',
  allowMockScreenshotsIfDenied: true,
};

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeEntry(
  id: string,
  employeeId: string,
  employeeName: string,
  clientId: string,
  clientName: string,
  taskDescription: string,
  daysAgo: number,
  hourlyRate: number,
  durationHours: number
): TimeEntry {
  const startTime = NOW - daysAgo * DAY + 8 * 60 * 60 * 1000;
  const durationSeconds = Math.round(durationHours * 3600);
  const endTime = startTime + durationSeconds * 1000;
  return {
    id,
    employeeId,
    employeeName,
    clientId,
    clientName,
    taskDescription,
    startTime,
    endTime,
    durationSeconds,
    pausedSeconds: 0,
    status: 'completed' as const,
    hourlyRate,
    totalPay: parseFloat(((durationSeconds / 3600) * hourlyRate).toFixed(2)),
    screenshotCount: Math.floor(durationHours / (10 / 60)),
    syncStatus: 'synced' as const,
    syncedAt: endTime + 5000,
  };
}

const DEFAULT_TIME_ENTRIES: TimeEntry[] = [
  makeEntry('te-1', 'emp-2', 'John Doe (Developer)', 'cli-1', 'Acme Corporation', 'REST API integration & unit testing', 1, 35, 6.5),
  makeEntry('te-2', 'emp-3', 'Jane Smith (UI Designer)', 'cli-2', 'Stark Global', 'Dashboard UI redesign — wireframes & prototypes', 1, 40, 5),
  makeEntry('te-3', 'emp-4', 'Alex Rivera (QA Tester)', 'cli-1', 'Acme Corporation', 'Regression test suite for v2.4 release', 1, 30, 4),
  makeEntry('te-4', 'emp-2', 'John Doe (Developer)', 'cli-3', 'Wayne Enterprises', 'Authentication module & JWT refresh tokens', 2, 35, 7),
  makeEntry('te-5', 'emp-3', 'Jane Smith (UI Designer)', 'cli-3', 'Wayne Enterprises', 'Mobile-responsive layout & accessibility audit', 2, 40, 6),
  makeEntry('te-6', 'emp-4', 'Alex Rivera (QA Tester)', 'cli-4', 'Cyberdyne Systems', 'Automated E2E tests using Playwright', 2, 30, 5.5),
  makeEntry('te-7', 'emp-2', 'John Doe (Developer)', 'cli-2', 'Stark Global', 'Performance profiling & database query optimization', 3, 35, 8),
  makeEntry('te-8', 'emp-3', 'Jane Smith (UI Designer)', 'cli-4', 'Cyberdyne Systems', 'Brand style guide & design system documentation', 3, 40, 4.5),
];

const SETTINGS_DOC_ID = 'appSettings';

// Local storage keys for robust offline fallback
const STORAGE_KEYS = {
  EMPLOYEES: 'tt_supabase_employees',
  CLIENTS: 'tt_supabase_clients',
  TIME_ENTRIES: 'tt_supabase_time_entries',
  SCREENSHOTS: 'tt_supabase_screenshots',
  SETTINGS: 'tt_supabase_settings',
  CONTRACTS: 'tt_supabase_contracts',
  PAYOUTS: 'tt_supabase_payouts',
  APPROVALS: 'tt_supabase_timesheet_approvals',
  PERMISSIONS: 'tt_supabase_team_permissions',
};

function toContract(row: Record<string, any>): Contract {
  return {
    id: String(row['id'] || ''),
    employeeId: String(row['employeeId'] ?? row['employee_id'] ?? ''),
    clientId: String(row['clientId'] ?? row['client_id'] ?? ''),
    payRate: Number(row['payRate'] ?? row['pay_rate'] ?? 0),
    billRate: Number(row['billRate'] ?? row['bill_rate'] ?? 0),
    weeklyLimitHours:
      row['weeklyLimitHours'] ?? row['weekly_limit_hours'] ?? null
        ? Number(row['weeklyLimitHours'] ?? row['weekly_limit_hours'])
        : undefined,
    active: row['active'] !== false && row['active'] !== 'false',
  };
}

// ── Flexible Normalizer Helpers ─────────────────────────────────────────────

function toEmployee(row: Record<string, any>): Employee {
  return {
    id: String(row['id'] || ''),
    name: String(row['name'] || ''),
    email: String(row['email'] || ''),
    role: (row['role'] || 'user') as UserRole,
    hourlyRate: Number(row['hourlyRate'] ?? row['hourly_rate'] ?? row['hourlyrate'] ?? 0),
    pin: row['pin'] != null ? String(row['pin']) : undefined,
    department: row['department'] != null ? String(row['department']) : undefined,
    avatarColor: String(row['avatarColor'] || row['avatar_color'] || row['avatarcolor'] || '#3b82f6'),
    active: row['active'] !== false && row['active'] !== 'false',
  };
}

function toClient(row: Record<string, any>): Client {
  return {
    id: String(row['id'] || ''),
    name: String(row['name'] || ''),
    code: String(row['code'] || ''),
    defaultRate: row['defaultRate'] ?? row['default_rate'] ?? row['defaultrate'] != null ? Number(row['defaultRate'] ?? row['default_rate'] ?? row['defaultrate']) : undefined,
    color: row['color'] != null ? String(row['color']) : undefined,
    active: row['active'] !== false && row['active'] !== 'false',
  };
}

function toTimeEntry(row: Record<string, any>): TimeEntry {
  return {
    id: String(row['id'] || ''),
    employeeId: String(row['employeeId'] ?? row['employee_id'] ?? row['employeeid'] ?? ''),
    employeeName: String(row['employeeName'] ?? row['employee_name'] ?? row['employeename'] ?? ''),
    clientId: String(row['clientId'] ?? row['client_id'] ?? row['clientid'] ?? ''),
    clientName: String(row['clientName'] ?? row['client_name'] ?? row['clientname'] ?? ''),
    taskDescription: String(row['taskDescription'] ?? row['task_description'] ?? row['taskdescription'] ?? ''),
    startTime: Number(row['startTime'] ?? row['start_time'] ?? row['starttime'] ?? Date.now()),
    endTime: row['endTime'] ?? row['end_time'] ?? row['endtime'] != null ? Number(row['endTime'] ?? row['end_time'] ?? row['endtime']) : undefined,
    durationSeconds: Number(row['durationSeconds'] ?? row['duration_seconds'] ?? row['durationseconds'] ?? 0),
    pausedSeconds: Number(row['pausedSeconds'] ?? row['paused_seconds'] ?? row['pausedseconds'] ?? 0),
    status: (row['status'] || 'completed') as any,
    hourlyRate: Number(row['hourlyRate'] ?? row['hourly_rate'] ?? row['hourlyrate'] ?? 0),
    totalPay: Number(row['totalPay'] ?? row['total_pay'] ?? row['totalpay'] ?? 0),
    screenshotCount: Number(row['screenshotCount'] ?? row['screenshot_count'] ?? row['screenshotcount'] ?? 0),
    syncStatus: (row['syncStatus'] ?? row['sync_status'] ?? row['syncstatus'] ?? 'synced') as any,
    syncedAt: row['syncedAt'] ?? row['synced_at'] ?? row['syncedat'] != null ? Number(row['syncedAt'] ?? row['synced_at'] ?? row['syncedat']) : undefined,
    lastSyncError: row['lastSyncError'] ?? row['last_sync_error'] ?? row['lastsyncerror'] != null ? String(row['lastSyncError'] ?? row['last_sync_error'] ?? row['lastsyncerror']) : undefined,
    lastPauseTime: row['lastPauseTime'] ?? row['last_pause_time'] ?? row['lastpausetime'] != null ? Number(row['lastPauseTime'] ?? row['last_pause_time'] ?? row['lastpausetime']) : undefined,
  };
}

function toScreenshotRecord(row: Record<string, any>): ScreenshotRecord {
  return {
    id: String(row['id'] || ''),
    timeEntryId: String(row['timeEntryId'] ?? row['time_entry_id'] ?? row['timeentryid'] ?? ''),
    employeeId: String(row['employeeId'] ?? row['employee_id'] ?? row['employeeid'] ?? ''),
    employeeName: String(row['employeeName'] ?? row['employee_name'] ?? row['employeename'] ?? ''),
    timestamp: Number(row['timestamp'] ?? Date.now()),
    imageDataUrl: String(row['imageDataUrl'] ?? row['image_data_url'] ?? row['imagedataurl'] ?? ''),
    thumbnailDataUrl: row['thumbnailDataUrl'] ?? row['thumbnail_data_url'] ?? row['thumbnaildataurl'] != null ? String(row['thumbnailDataUrl'] ?? row['thumbnail_data_url'] ?? row['thumbnaildataurl']) : undefined,
    driveFileId: row['driveFileId'] ?? row['drive_file_id'] ?? row['drivefileid'] != null ? String(row['driveFileId'] ?? row['drive_file_id'] ?? row['drivefileid']) : undefined,
    driveViewUrl: row['driveViewUrl'] ?? row['drive_view_url'] ?? row['driveviewurl'] != null ? String(row['driveViewUrl'] ?? row['drive_view_url'] ?? row['driveviewurl']) : undefined,
    synced: row['synced'] !== false && row['synced'] !== 'false',
    syncedAt: row['syncedAt'] ?? row['synced_at'] ?? row['syncedat'] != null ? Number(row['syncedAt'] ?? row['synced_at'] ?? row['syncedat']) : undefined,
  };
}

function toAppSettings(row: Record<string, any>): AppSettings {
  return {
    screenshotIntervalMinutes: Number(row['screenshotIntervalMinutes'] ?? row['screenshot_interval_minutes'] ?? row['screenshotintervalminutes'] ?? 10),
    autoSync: row['autoSync'] ?? row['auto_sync'] ?? row['autosync'] !== false,
    adminPin: String(row['adminPin'] ?? row['admin_pin'] ?? row['adminpin'] ?? 'admin123'),
    activeEmployeeId: row['activeEmployeeId'] ?? row['active_employee_id'] ?? row['activeemployeeid'] != null ? String(row['activeEmployeeId'] ?? row['active_employee_id'] ?? row['activeemployeeid']) : undefined,
    activeRole: row['activeRole'] ?? row['active_role'] ?? row['activerole'] != null ? (row['activeRole'] ?? row['active_role'] ?? row['activerole']) : undefined,
    lastSyncTime: row['lastSyncTime'] ?? row['last_sync_time'] ?? row['lastsynctime'] != null ? Number(row['lastSyncTime'] ?? row['last_sync_time'] ?? row['lastsynctime']) : undefined,
    allowMockScreenshotsIfDenied: row['allowMockScreenshotsIfDenied'] ?? row['allow_mock_screenshots_if_denied'] ?? row['allowmockscreenshotsifdenied'] !== false,
  };
}

@Injectable({ providedIn: 'root' })
export class OfflineStorageService {
  private seedPromise: Promise<void> | null = null;

  constructor() {
    this.seedPromise = this._seedDefaults();
  }

  private get supabase() {
    return getSupabaseClient();
  }

  // ── LocalStorage Fallback Helpers ─────────────────────────────────────────

  private getLocal<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  }

  private setLocal<T>(key: string, value: T): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[OfflineStorage] LocalStorage write error:', e);
    }
  }

  // ── Seed defaults ─────────────────────────────────────────────────────────

  private async _seedDefaults(): Promise<void> {
    try {
      // 1. Employees
      const { data: emps, error: empErr } = await this.supabase
        .from('employees')
        .select('*');

      if (empErr) {
        console.warn('[Supabase] Employees query warning:', empErr.message);
      }

      if (empErr || !emps || emps.length === 0) {
        const localEmps = this.getLocal(STORAGE_KEYS.EMPLOYEES, DEFAULT_EMPLOYEES);
        this.setLocal(STORAGE_KEYS.EMPLOYEES, localEmps);
        try {
          await this.supabase.from('employees').upsert(localEmps);
        } catch {}
      } else {
        const mapped = emps.map(toEmployee);
        this.setLocal(STORAGE_KEYS.EMPLOYEES, mapped);
      }

      // 2. Clients
      const { data: clis, error: cliErr } = await this.supabase
        .from('clients')
        .select('*');

      if (cliErr || !clis || clis.length === 0) {
        const localClis = this.getLocal(STORAGE_KEYS.CLIENTS, DEFAULT_CLIENTS);
        this.setLocal(STORAGE_KEYS.CLIENTS, localClis);
        try {
          await this.supabase.from('clients').upsert(localClis);
        } catch {}
      } else {
        const mapped = clis.map(toClient);
        this.setLocal(STORAGE_KEYS.CLIENTS, mapped);
      }

      // 3. Settings
      const { data: set, error: setErr } = await this.supabase
        .from('app_settings')
        .select('*')
        .eq('id', SETTINGS_DOC_ID)
        .maybeSingle();

      if (setErr || !set) {
        const localSet = this.getLocal(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
        this.setLocal(STORAGE_KEYS.SETTINGS, localSet);
        try {
          await this.supabase.from('app_settings').upsert({ id: SETTINGS_DOC_ID, ...localSet });
        } catch {}
      } else {
        const mapped = toAppSettings(set);
        this.setLocal(STORAGE_KEYS.SETTINGS, mapped);
      }

      // 4. Time Entries
      const { data: tes, error: teErr } = await this.supabase
        .from('time_entries')
        .select('*');

      if (teErr || !tes || tes.length === 0) {
        // Never push demo time entries into a real database
        const localTes = this.getLocal<TimeEntry[]>(STORAGE_KEYS.TIME_ENTRIES, []);
        this.setLocal(STORAGE_KEYS.TIME_ENTRIES, localTes);
        try {
          await this.supabase.from('time_entries').upsert(localTes);
        } catch {}
      } else {
        const mapped = tes.map(toTimeEntry);
        this.setLocal(STORAGE_KEYS.TIME_ENTRIES, mapped);
      }
    } catch (err) {
      console.warn('[SupabaseStorage] Seed check completed (fallback enabled):', err);
    }
  }

  private async waitForSeed(): Promise<void> {
    if (this.seedPromise) await this.seedPromise;
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  async getEmployees(): Promise<Employee[]> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase.from('employees').select('*');
      if (error) {
        console.warn('[Supabase DB Error - employees]:', error.message, '| Hint:', error.hint || 'Check RLS policy or table in Supabase');
      } else if (data && data.length > 0) {
        const list = data.map(toEmployee);
        this.setLocal(STORAGE_KEYS.EMPLOYEES, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local employees fallback:', e);
    }
    return this.getLocal<Employee[]>(STORAGE_KEYS.EMPLOYEES, DEFAULT_EMPLOYEES);
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!error && data) return toEmployee(data);
    } catch (e) {
      console.warn('[SupabaseStorage] Error fetching employee:', e);
    }
    const emps = await this.getEmployees();
    return emps.find((e) => e.id === id) || null;
  }

  async saveEmployee(employee: Employee): Promise<void> {
    const list = await this.getEmployees();
    const idx = list.findIndex((e) => e.id === employee.id);
    if (idx >= 0) list[idx] = employee;
    else list.push(employee);
    this.setLocal(STORAGE_KEYS.EMPLOYEES, list);

    try {
      const { error } = await this.supabase.from('employees').upsert(employee);
      if (error) {
        console.warn('[Supabase Save Error - employees]:', error.message);
      }
    } catch (err) {
      console.warn('[SupabaseStorage] Offline save queued locally:', err);
    }
  }

  async deleteEmployee(id: string): Promise<void> {
    const list = await this.getEmployees();
    this.setLocal(
      STORAGE_KEYS.EMPLOYEES,
      list.filter((e) => e.id !== id)
    );

    try {
      await this.supabase.from('employees').delete().eq('id', id);
    } catch (err) {
      console.warn('[SupabaseStorage] Delete error:', err);
    }
  }

  // ── Clients ───────────────────────────────────────────────────────────────

  async getClients(): Promise<Client[]> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase.from('clients').select('*');
      if (error) {
        console.warn('[Supabase DB Error - clients]:', error.message);
      } else if (data && data.length > 0) {
        const list = data.map(toClient);
        this.setLocal(STORAGE_KEYS.CLIENTS, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local clients fallback:', e);
    }
    return this.getLocal<Client[]>(STORAGE_KEYS.CLIENTS, DEFAULT_CLIENTS);
  }

  async saveClient(client: Client): Promise<void> {
    const list = await this.getClients();
    const idx = list.findIndex((c) => c.id === client.id);
    if (idx >= 0) list[idx] = client;
    else list.push(client);
    this.setLocal(STORAGE_KEYS.CLIENTS, list);

    try {
      await this.supabase.from('clients').upsert(client);
    } catch (err) {
      console.warn('[SupabaseStorage] Offline client save queued locally:', err);
    }
  }

  async deleteClient(id: string): Promise<void> {
    const list = await this.getClients();
    this.setLocal(
      STORAGE_KEYS.CLIENTS,
      list.filter((c) => c.id !== id)
    );

    try {
      await this.supabase.from('clients').delete().eq('id', id);
    } catch (err) {
      console.warn('[SupabaseStorage] Delete client error:', err);
    }
  }

  // ── Time Entries ──────────────────────────────────────────────────────────

  async getTimeEntries(): Promise<TimeEntry[]> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase
        .from('time_entries')
        .select('*');

      if (error) {
        console.warn('[Supabase DB Error - time_entries]:', error.message);
      } else if (data && data.length > 0) {
        const cloud = data.map(toTimeEntry);
        // Keep time saved on this device that hasn't been uploaded yet
        const cloudIds = new Set(cloud.map((e) => e.id));
        const unsynced = this.getLocal<TimeEntry[]>(STORAGE_KEYS.TIME_ENTRIES, []).filter(
          (e) => e.syncStatus !== 'synced' && !cloudIds.has(e.id)
        );
        const list = [...cloud, ...unsynced].sort((a, b) => b.startTime - a.startTime);
        this.setLocal(STORAGE_KEYS.TIME_ENTRIES, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local time entries fallback:', e);
    }
    return this.getLocal<TimeEntry[]>(STORAGE_KEYS.TIME_ENTRIES, []);
  }

  async getActiveTimeEntry(employeeId?: string): Promise<TimeEntry | null> {
    try {
      let builder = this.supabase
        .from('time_entries')
        .select('*')
        .in('status', ['active', 'paused']);

      if (employeeId) {
        builder = builder.eq('employeeId', employeeId);
      }

      const { data, error } = await builder.maybeSingle();
      if (!error && data) return toTimeEntry(data);
    } catch (e) {
      console.warn('[SupabaseStorage] Error fetching active time entry:', e);
    }

    const entries = await this.getTimeEntries();
    return (
      entries.find(
        (e) =>
          (e.status === 'active' || e.status === 'paused') &&
          (!employeeId || e.employeeId === employeeId)
      ) || null
    );
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    try {
      const { data, error } = await this.supabase
        .from('time_entries')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) return toTimeEntry(data);
    } catch (e) {
      console.warn('[SupabaseStorage] Error fetching entry by id:', e);
    }

    const entries = await this.getTimeEntries();
    return entries.find((e) => e.id === id) || null;
  }

  async saveTimeEntry(entry: TimeEntry): Promise<void> {
    const list = await this.getTimeEntries();
    const idx = list.findIndex((e) => e.id === entry.id);
    if (idx >= 0) list[idx] = entry;
    else list.unshift(entry);
    this.setLocal(STORAGE_KEYS.TIME_ENTRIES, list);

    try {
      await this.supabase.from('time_entries').upsert(entry);
    } catch (err) {
      console.warn('[SupabaseStorage] Save time entry error (cached locally):', err);
    }
  }

  async deleteTimeEntry(id: string): Promise<void> {
    const list = await this.getTimeEntries();
    this.setLocal(
      STORAGE_KEYS.TIME_ENTRIES,
      list.filter((e) => e.id !== id)
    );

    const screenshots = await this.getScreenshots();
    this.setLocal(
      STORAGE_KEYS.SCREENSHOTS,
      screenshots.filter((s) => s.timeEntryId !== id)
    );

    try {
      await this.supabase.from('screenshots').delete().eq('timeEntryId', id);
      await this.supabase.from('time_entries').delete().eq('id', id);
    } catch (err) {
      console.warn('[SupabaseStorage] Delete time entry error:', err);
    }
  }

  // ── Contracts (pay & bill rate per member per client) ─────────────────────
  // Needs the "contracts" table in Supabase (supabase_migration_002_contracts.sql).
  // Until that table exists, contracts are kept in this browser only.

  async getContracts(): Promise<Contract[]> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase.from('contracts').select('*');
      if (error) {
        console.warn('[Supabase DB Error - contracts]:', error.message, '| Run supabase_migration_002_contracts.sql');
      } else if (data) {
        const list = data.map(toContract);
        this.setLocal(STORAGE_KEYS.CONTRACTS, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local contracts fallback:', e);
    }
    return this.getLocal<Contract[]>(STORAGE_KEYS.CONTRACTS, []);
  }

  async saveContract(contract: Contract): Promise<void> {
    const list = this.getLocal<Contract[]>(STORAGE_KEYS.CONTRACTS, []);
    const idx = list.findIndex((c) => c.id === contract.id);
    if (idx >= 0) list[idx] = contract;
    else list.push(contract);
    this.setLocal(STORAGE_KEYS.CONTRACTS, list);

    try {
      const { error } = await this.supabase.from('contracts').upsert(contract);
      if (error) console.warn('[Supabase] Contract not saved to cloud:', error.message);
    } catch (err) {
      console.warn('[SupabaseStorage] Save contract error (cached locally):', err);
    }
  }

  async deleteContract(id: string): Promise<void> {
    const list = this.getLocal<Contract[]>(STORAGE_KEYS.CONTRACTS, []);
    this.setLocal(STORAGE_KEYS.CONTRACTS, list.filter((c) => c.id !== id));
    try {
      await this.supabase.from('contracts').delete().eq('id', id);
    } catch (err) {
      console.warn('[SupabaseStorage] Delete contract error:', err);
    }
  }

  /** True when the Supabase tables added in migration 002 exist. */
  async cloudTablesReady(): Promise<boolean> {
    try {
      const [c, p, a] = await Promise.all([
        this.supabase.from('contracts').select('id').limit(1),
        this.supabase.from('payouts').select('id').limit(1),
        this.supabase.from('timesheet_approvals').select('id').limit(1),
      ]);
      const t = await this.supabase.from('team_permissions').select('id').limit(1);
      return !c.error && !p.error && !a.error && !t.error;
    } catch {
      return false;
    }
  }

  // ── Payouts (who was paid for which pay period) ──────────────────────────

  async getPayouts(): Promise<Payout[]> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase.from('payouts').select('*');
      if (!error && data) {
        const list = data.map((row: Record<string, any>) => ({
          id: String(row['id']),
          employeeId: String(row['employeeId'] ?? row['employee_id'] ?? ''),
          employeeName: String(row['employeeName'] ?? row['employee_name'] ?? ''),
          periodStart: Number(row['periodStart'] ?? row['period_start'] ?? 0),
          periodEnd: Number(row['periodEnd'] ?? row['period_end'] ?? 0),
          hours: Number(row['hours'] ?? 0),
          amount: Number(row['amount'] ?? 0),
          paidAt: Number(row['paidAt'] ?? row['paid_at'] ?? 0),
          note: row['note'] != null ? String(row['note']) : undefined,
        }));
        this.setLocal(STORAGE_KEYS.PAYOUTS, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local payouts fallback:', e);
    }
    return this.getLocal<Payout[]>(STORAGE_KEYS.PAYOUTS, []);
  }

  async savePayout(payout: Payout): Promise<void> {
    const list = this.getLocal<Payout[]>(STORAGE_KEYS.PAYOUTS, []);
    const idx = list.findIndex((p) => p.id === payout.id);
    if (idx >= 0) list[idx] = payout;
    else list.push(payout);
    this.setLocal(STORAGE_KEYS.PAYOUTS, list);
    try {
      const { error } = await this.supabase.from('payouts').upsert(payout);
      if (error) console.warn('[Supabase] Payout not saved to cloud:', error.message);
    } catch (err) {
      console.warn('[SupabaseStorage] Save payout error (cached locally):', err);
    }
  }

  async deletePayout(id: string): Promise<void> {
    const list = this.getLocal<Payout[]>(STORAGE_KEYS.PAYOUTS, []);
    this.setLocal(STORAGE_KEYS.PAYOUTS, list.filter((p) => p.id !== id));
    try {
      await this.supabase.from('payouts').delete().eq('id', id);
    } catch (err) {
      console.warn('[SupabaseStorage] Delete payout error:', err);
    }
  }

  // ── Timesheet approvals (submit → approve per pay period) ────────────────

  async getApprovals(): Promise<TimesheetApproval[]> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase.from('timesheet_approvals').select('*');
      if (!error && data) {
        const list = data.map((row: Record<string, any>) => ({
          id: String(row['id']),
          employeeId: String(row['employeeId'] ?? ''),
          employeeName: String(row['employeeName'] ?? ''),
          periodStart: Number(row['periodStart'] ?? 0),
          periodEnd: Number(row['periodEnd'] ?? 0),
          status: row['status'] as TimesheetApproval['status'],
          hours: Number(row['hours'] ?? 0),
          submittedAt: Number(row['submittedAt'] ?? 0),
          reviewedAt: row['reviewedAt'] != null ? Number(row['reviewedAt']) : undefined,
          note: row['note'] != null ? String(row['note']) : undefined,
        }));
        this.setLocal(STORAGE_KEYS.APPROVALS, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local approvals fallback:', e);
    }
    return this.getLocal<TimesheetApproval[]>(STORAGE_KEYS.APPROVALS, []);
  }

  async saveApproval(approval: TimesheetApproval): Promise<void> {
    const list = this.getLocal<TimesheetApproval[]>(STORAGE_KEYS.APPROVALS, []);
    const idx = list.findIndex((a) => a.id === approval.id);
    if (idx >= 0) list[idx] = approval;
    else list.push(approval);
    this.setLocal(STORAGE_KEYS.APPROVALS, list);
    try {
      const { error } = await this.supabase.from('timesheet_approvals').upsert(approval);
      if (error) console.warn('[Supabase] Timesheet approval not saved to cloud:', error.message);
    } catch (err) {
      console.warn('[SupabaseStorage] Save approval error (cached locally):', err);
    }
  }

  // ── Team access (what team members can see and do) ──────────────────────

  async getPermissions(): Promise<TeamPermissionRow[]> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase.from('team_permissions').select('*');
      if (!error && data) {
        const list = data.map((row: Record<string, any>) => ({
          id: String(row['id']),
          permissions: row['permissions'] ?? {},
        }));
        this.setLocal(STORAGE_KEYS.PERMISSIONS, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local permissions fallback:', e);
    }
    return this.getLocal<TeamPermissionRow[]>(STORAGE_KEYS.PERMISSIONS, []);
  }

  async savePermission(row: TeamPermissionRow): Promise<void> {
    const list = this.getLocal<TeamPermissionRow[]>(STORAGE_KEYS.PERMISSIONS, []);
    const idx = list.findIndex((r) => r.id === row.id);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    this.setLocal(STORAGE_KEYS.PERMISSIONS, list);
    try {
      const { error } = await this.supabase.from('team_permissions').upsert(row);
      if (error) console.warn('[Supabase] Team access not saved to cloud:', error.message);
    } catch (err) {
      console.warn('[SupabaseStorage] Save permission error (cached locally):', err);
    }
  }

  async deletePermission(id: string): Promise<void> {
    const list = this.getLocal<TeamPermissionRow[]>(STORAGE_KEYS.PERMISSIONS, []);
    this.setLocal(STORAGE_KEYS.PERMISSIONS, list.filter((r) => r.id !== id));
    try {
      await this.supabase.from('team_permissions').delete().eq('id', id);
    } catch (err) {
      console.warn('[SupabaseStorage] Delete permission error:', err);
    }
  }

  // ── Screenshots ───────────────────────────────────────────────────────────

  async getScreenshots(timeEntryId?: string): Promise<ScreenshotRecord[]> {
    await this.waitForSeed();
    try {
      let builder = this.supabase
        .from('screenshots')
        .select('*');

      if (timeEntryId) {
        builder = builder.eq('timeEntryId', timeEntryId);
      }

      const { data, error } = await builder;
      if (!error && data && data.length > 0) {
        const list = data.map(toScreenshotRecord).sort((a, b) => b.timestamp - a.timestamp);
        if (!timeEntryId) this.setLocal(STORAGE_KEYS.SCREENSHOTS, list);
        return list;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local screenshots fallback:', e);
    }

    const all = this.getLocal<ScreenshotRecord[]>(STORAGE_KEYS.SCREENSHOTS, []);
    return timeEntryId ? all.filter((s) => s.timeEntryId === timeEntryId) : all;
  }

  async saveScreenshot(record: ScreenshotRecord): Promise<void> {
    const list = await this.getScreenshots();
    const idx = list.findIndex((s) => s.id === record.id);
    if (idx >= 0) list[idx] = record;
    else list.unshift(record);
    this.setLocal(STORAGE_KEYS.SCREENSHOTS, list);

    try {
      await this.supabase.from('screenshots').upsert(record);
    } catch (err) {
      console.warn('[SupabaseStorage] Screenshot save error (cached locally):', err);
    }
  }

  async deleteScreenshot(id: string): Promise<void> {
    const list = await this.getScreenshots();
    this.setLocal(
      STORAGE_KEYS.SCREENSHOTS,
      list.filter((s) => s.id !== id)
    );

    try {
      await this.supabase.from('screenshots').delete().eq('id', id);
    } catch (err) {
      console.warn('[SupabaseStorage] Delete screenshot error:', err);
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    await this.waitForSeed();
    try {
      const { data, error } = await this.supabase
        .from('app_settings')
        .select('*')
        .eq('id', SETTINGS_DOC_ID)
        .maybeSingle();

      if (!error && data) {
        const mapped = toAppSettings(data);
        const merged = { ...DEFAULT_SETTINGS, ...mapped };
        this.setLocal(STORAGE_KEYS.SETTINGS, merged);
        return merged;
      }
    } catch (e) {
      console.warn('[SupabaseStorage] Using local settings fallback:', e);
    }
    return this.getLocal<AppSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.setLocal(STORAGE_KEYS.SETTINGS, settings);
    try {
      await this.supabase
        .from('app_settings')
        .upsert({ id: SETTINGS_DOC_ID, ...settings });
    } catch (err) {
      console.warn('[SupabaseStorage] Settings save error:', err);
    }
  }

  // ── Sync helpers ──────────────────────────────────────────────────────────

  async getPendingSyncItems(): Promise<{
    entries: TimeEntry[];
    screenshots: ScreenshotRecord[];
  }> {
    const entries = await this.getTimeEntries();
    const screenshots = await this.getScreenshots();

    return {
      entries: entries.filter((e) => e.syncStatus !== 'synced'),
      screenshots: screenshots.filter((s) => !s.synced),
    };
  }

  /**
   * Upload time entries and screenshots that were saved while offline.
   * Returns the ids that the database accepted (only those should be marked synced).
   */
  async uploadPending(
    entries: TimeEntry[],
    screenshots: ScreenshotRecord[]
  ): Promise<{ entryIds: string[]; screenshotIds: string[]; errors: string[] }> {
    const entryIds: string[] = [];
    const screenshotIds: string[] = [];
    const errors: string[] = [];
    for (const entry of entries) {
      const { error } = await this.supabase.from('time_entries').upsert({ ...entry, syncStatus: 'synced', syncedAt: Date.now() });
      if (error) errors.push(error.message);
      else entryIds.push(entry.id);
    }
    for (const shot of screenshots) {
      const { error } = await this.supabase.from('screenshots').upsert({ ...shot, synced: true, syncedAt: Date.now() });
      if (error) errors.push(error.message);
      else screenshotIds.push(shot.id);
    }
    return { entryIds, screenshotIds, errors };
  }

  async markEntriesAsSynced(
    entryIds: string[],
    screenshotDriveMap: Record<string, { fileId: string; viewUrl: string }> = {}
  ): Promise<void> {
    if (!entryIds.length && !Object.keys(screenshotDriveMap).length) return;

    const now = Date.now();

    // Update local entries
    const entries = await this.getTimeEntries();
    for (const entry of entries) {
      if (entryIds.includes(entry.id)) {
        entry.syncStatus = 'synced';
        entry.syncedAt = now;
        entry.lastSyncError = undefined;
        try {
          await this.supabase
            .from('time_entries')
            .update({ syncStatus: 'synced', syncedAt: now, lastSyncError: null })
            .eq('id', entry.id);
        } catch {}
      }
    }
    this.setLocal(STORAGE_KEYS.TIME_ENTRIES, entries);

    // Update local screenshots
    const screenshots = await this.getScreenshots();
    for (const ss of screenshots) {
      if (screenshotDriveMap[ss.id]) {
        const driveData = screenshotDriveMap[ss.id];
        ss.synced = true;
        ss.syncedAt = now;
        ss.driveFileId = driveData.fileId;
        ss.driveViewUrl = driveData.viewUrl;
        try {
          await this.supabase
            .from('screenshots')
            .update({
              synced: true,
              syncedAt: now,
              driveFileId: driveData.fileId,
              driveViewUrl: driveData.viewUrl,
            })
            .eq('id', ss.id);
        } catch {}
      }
    }
    this.setLocal(STORAGE_KEYS.SCREENSHOTS, screenshots);
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

    const employees = toArray<Employee>(data.employees);
    if (employees.length) {
      this.setLocal(STORAGE_KEYS.EMPLOYEES, employees);
      try {
        await this.supabase.from('employees').upsert(employees);
      } catch {}
    }

    const clients = toArray<Client>(data.clients);
    if (clients.length) {
      this.setLocal(STORAGE_KEYS.CLIENTS, clients);
      try {
        await this.supabase.from('clients').upsert(clients);
      } catch {}
    }

    const contracts = toArray<Contract>(data.contracts);
    for (const contract of contracts) {
      await this.saveContract(contract);
    }

    for (const payout of toArray<Payout>(data.payouts)) {
      await this.savePayout(payout);
    }

    const timeEntries = toArray<TimeEntry>(data.timeEntries || data.time_entries);
    if (timeEntries.length) {
      this.setLocal(STORAGE_KEYS.TIME_ENTRIES, timeEntries);
      try {
        await this.supabase.from('time_entries').upsert(timeEntries);
      } catch {}
    }

    const screenshots = toArray<ScreenshotRecord>(data.screenshots || data.screenshot_records);
    if (screenshots.length) {
      this.setLocal(STORAGE_KEYS.SCREENSHOTS, screenshots);
      try {
        await this.supabase.from('screenshots').upsert(screenshots);
      } catch {}
    }

    if (data.settings) {
      this.setLocal(STORAGE_KEYS.SETTINGS, data.settings);
      try {
        await this.supabase
          .from('app_settings')
          .upsert({ id: SETTINGS_DOC_ID, ...data.settings });
      } catch {}
    }
  }
}
