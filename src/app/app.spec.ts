import { describe, it, expect, beforeEach } from 'vitest';
import { FormatDurationPipe } from './pipes/format-duration.pipe';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { Employee, AppSettings } from './models/time-tracker.models';

// Mock localStorage if in node test environment
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

const MOCK_EMPLOYEES: Employee[] = [
  {
    id: 'emp-1',
    name: 'Sarah Connor (Admin)',
    email: 'sarah@example.com',
    role: 'admin',
    hourlyRate: 55,
    pin: '1234',
    active: true,
  },
  {
    id: 'emp-2',
    name: 'John Doe (Developer)',
    email: 'john@example.com',
    role: 'user',
    hourlyRate: 35,
    pin: '1234',
    active: true,
  },
];

const MOCK_SETTINGS: AppSettings = {
  screenshotIntervalMinutes: 10,
  adminPin: 'admin123',
  allowMockScreenshotsIfDenied: true,
};

class MockDataService extends DataService {
  override async getEmployees(): Promise<Employee[]> {
    return [...MOCK_EMPLOYEES];
  }

  override async getEmployeeById(id: string): Promise<Employee | null> {
    return MOCK_EMPLOYEES.find((e) => e.id === id) ?? null;
  }

  override async getSettings(): Promise<AppSettings> {
    return { ...MOCK_SETTINGS };
  }

  override async saveEmployee(): Promise<void> {}
  override async deleteEmployee(): Promise<void> {}
  override async getClients() { return []; }
  override async saveClient() {}
  override async deleteClient() {}
  override async getTimeEntries() { return []; }
  override async getActiveTimeEntry() { return null; }
  override async getTimeEntryById() { return null; }
  override async saveTimeEntry() {}
  override async deleteTimeEntry() {}
  override async getScreenshots() { return []; }
  override async saveScreenshot() {}
  override async deleteScreenshot() {}
  override async saveSettings() {}
  override async exportAllData() { return '{}'; }
  override async importData() {}
}

// ── AuthService Tests ─────────────────────────────────────────────────────────

describe('AuthService', () => {
  let authService: AuthService;
  let mockStorage: MockDataService;

  beforeEach(async () => {
    localStorage.clear();
    mockStorage = new MockDataService();
    authService = new AuthService(mockStorage);
    await authService.restoreSession();
  });

  it('should start unauthenticated', () => {
    expect(authService.isLoggedIn()).toBe(false);
    expect(authService.currentUser()).toBeNull();
  });

  it('should login normal user successfully with correct PIN', async () => {
    const res = await authService.loginUser('emp-2', '1234');
    expect(res.success).toBe(true);
    expect(authService.isLoggedIn()).toBe(true);
    expect(authService.isAdmin()).toBe(false);
    expect(authService.currentUser()?.name).toContain('John Doe');
  });

  it('should reject normal user with incorrect PIN', async () => {
    const res = await authService.loginUser('emp-2', 'wrong');
    expect(res.success).toBe(false);
    expect(authService.isLoggedIn()).toBe(false);
  });

  it('should login admin with valid admin PIN', async () => {
    const res = await authService.loginAdmin('admin123');
    expect(res.success).toBe(true);
    expect(authService.isLoggedIn()).toBe(true);
    expect(authService.isAdmin()).toBe(true);
  });

  it('should reject admin login with invalid PIN', async () => {
    const res = await authService.loginAdmin('wrongpin');
    expect(res.success).toBe(false);
    expect(authService.isAdmin()).toBe(false);
  });

  it('should allow normal user to change their PIN', async () => {
    await authService.loginUser('emp-2', '1234');
    const res = await authService.changeCurrentUserPin('9876', '1234');
    expect(res.success).toBe(true);
    expect(authService.currentUser()?.pin).toBe('9876');
  });

  it('should reject PIN change if current PIN is incorrect', async () => {
    await authService.loginUser('emp-2', '1234');
    const res = await authService.changeCurrentUserPin('9876', '0000');
    expect(res.success).toBe(false);
    expect(res.message).toContain('Current PIN is incorrect');
  });

  it('should reject PIN change if new PIN is too short', async () => {
    await authService.loginUser('emp-2', '1234');
    const res = await authService.changeCurrentUserPin('12', '1234');
    expect(res.success).toBe(false);
    expect(res.message).toContain('at least 4 characters');
  });

  it('should require a new PIN after signing in with the starting PIN (first name + 23)', async () => {
    const john = (await mockStorage.getEmployeeById('emp-2'))!;
    const original = john.pin;
    john.pin = 'john23';
    const login = await authService.loginUser('emp-2', 'John23');
    expect(login.success).toBe(true);
    expect(authService.mustChangePin()).toBe(true);

    const sameAgain = await authService.changeCurrentUserPin('john23', 'john23');
    expect(sameAgain.success).toBe(false);

    const res = await authService.changeCurrentUserPin('blue7788', 'john23');
    expect(res.success).toBe(true);
    expect(authService.mustChangePin()).toBe(false);
    john.pin = original;
  });

  it('does not re-ask for a new PIN if the cloud never saved it (known sync issue)', async () => {
    // Person signs in with the starter PIN and picks their own — same as above.
    const john = (await mockStorage.getEmployeeById('emp-2'))!;
    const original = john.pin;
    john.pin = 'john23';
    await authService.loginUser('emp-2', 'John23');
    await authService.changeCurrentUserPin('blue7788', 'john23');
    expect(authService.mustChangePin()).toBe(false);

    // Simulate the cloud write silently failing: the stored record still has the
    // OLD starting PIN, as if the upsert to Supabase never went through.
    john.pin = 'john23';

    // A brand new AuthService (e.g. reopening the app tomorrow) reads that stale
    // record back from storage.
    const secondSession = new AuthService(mockStorage);
    const login = await secondSession.loginUser('emp-2', 'john23');
    expect(login.success).toBe(true);
    // Bug (before the fix): this would be true again, endlessly re-prompting.
    expect(secondSession.mustChangePin()).toBe(false);

    john.pin = original;
  });

  it('should allow admin user to change their PIN', async () => {
    await authService.loginUser('emp-1', '1234');
    expect(authService.isAdmin()).toBe(true);
    const res = await authService.changeCurrentUserPin('5555', '1234');
    expect(res.success).toBe(true);
    expect(authService.currentUser()?.pin).toBe('5555');
  });

  it('should logout cleanly', async () => {
    await authService.loginAdmin('admin123');
    authService.logout();
    expect(authService.isLoggedIn()).toBe(false);
    expect(authService.currentUser()).toBeNull();
  });
});

// ── FormatDurationPipe Tests ──────────────────────────────────────────────────

describe('FormatDurationPipe', () => {
  const pipe = new FormatDurationPipe();

  it('should format zero seconds as 00:00', () => {
    expect(pipe.transform(0)).toBe('00:00');
  });

  it('should format seconds into MM:SS when less than an hour', () => {
    expect(pipe.transform(125)).toBe('02:05');
  });

  it('should format seconds into HH:MM:SS when an hour or more', () => {
    expect(pipe.transform(3665)).toBe('01:01:05');
  });

  it('should handle null or negative gracefully', () => {
    expect(pipe.transform(null)).toBe('00:00:00');
    expect(pipe.transform(-10)).toBe('00:00');
  });
});
