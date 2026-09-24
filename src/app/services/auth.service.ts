import { Injectable, signal } from '@angular/core';
import { DataService } from './data.service';
import { Employee, UserRole } from '../models/time-tracker.models';

const SESSION_KEY = 'timetracker_auth_session';
/** Prefix for a per-device, per-employee flag: "this device already confirmed its own PIN." */
const PIN_CONFIRMED_PREFIX = 'timetracker_pin_confirmed_';

interface StoredSession {
  employeeId: string;
  role: UserRole;
  isAdminMode: boolean;
  timestamp: number;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  readonly currentUser = signal<Employee | null>(null);
  readonly isLoggedIn = signal<boolean>(false);
  readonly isAdmin = signal<boolean>(false);
  readonly isInitialized = signal<boolean>(false);
  /** True while the person is still using their starting PIN (first name + 23). */
  readonly mustChangePin = signal<boolean>(false);

  /** Starting PINs are the first name + "23", e.g. "kyeth23". They must be changed on first sign-in. */
  static starterPinFor(name: string): string {
    const first = name.replace(/\([^)]*\)/g, '').trim().split(/\s+/)[0] || '';
    return first.toLowerCase() + '23';
  }

  /**
   * True only when this employee still needs to set their own PIN.
   * Checks this device's own "already confirmed" flag first, so a PIN change that
   * saved locally but failed to reach the cloud (see known sync issue) doesn't
   * make the app ask again every time this person signs in on this device.
   */
  private isStarterPin(employee: Employee): boolean {
    if (this.hasConfirmedPin(employee.id)) return false;
    const pin = employee.pin?.trim().toLowerCase() ?? '';
    return pin !== '' && pin === AuthService.starterPinFor(employee.name);
  }

  /** Call this when an admin sets/resets someone's PIN by hand (e.g. in People), so
   * that device-level "already confirmed" memory doesn't hide the new starting PIN. */
  clearPinConfirmation(employeeId: string): void {
    try {
      localStorage.removeItem(PIN_CONFIRMED_PREFIX + employeeId);
    } catch {}
  }

  private hasConfirmedPin(employeeId: string): boolean {
    try {
      return localStorage.getItem(PIN_CONFIRMED_PREFIX + employeeId) === '1';
    } catch {
      return false;
    }
  }

  private markPinConfirmed(employeeId: string): void {
    try {
      localStorage.setItem(PIN_CONFIRMED_PREFIX + employeeId, '1');
    } catch {}
  }

  constructor(private db: DataService) {
    this.restoreSession();
  }

  async restoreSession(): Promise<void> {
    try {
      if (typeof window === 'undefined') return;

      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session: StoredSession = JSON.parse(raw);
        const employee = await this.db.getEmployeeById(session.employeeId);
        if (employee && employee.active) {
          const isAdminUser = session.isAdminMode || employee.role === 'admin';
          this.currentUser.set(employee);
          this.isLoggedIn.set(true);
          this.isAdmin.set(isAdminUser);
          this.mustChangePin.set(this.isStarterPin(employee));
          this.isInitialized.set(true);
          return;
        }
      }
    } catch (e) {
      console.warn('Could not restore auth session:', e);
    }
    this.isInitialized.set(true);
  }

  async loginUser(employeeId: string, pin?: string): Promise<{ success: boolean; message: string }> {
    const employee = await this.db.getEmployeeById(employeeId);
    if (!employee || !employee.active) {
      return { success: false, message: 'Employee not found or inactive.' };
    }

    // PIN validation:
    const employeePin = employee.pin?.trim() ?? '';
    if (employeePin !== '') {
      // Not case-sensitive, so "Kyeth23" and "kyeth23" both work
      if (!pin || pin.trim().toLowerCase() !== employeePin.toLowerCase()) {
        return { success: false, message: 'Invalid employee PIN code.' };
      }
    }

    const isAdminUser = employee.role === 'admin';
    this.currentUser.set(employee);
    this.isLoggedIn.set(true);
    this.isAdmin.set(isAdminUser);
    this.mustChangePin.set(this.isStarterPin(employee));

    this.saveSession({
      employeeId: employee.id,
      role: employee.role,
      isAdminMode: isAdminUser,
      timestamp: Date.now(),
    });

    return { success: true, message: `Welcome back, ${employee.name}!` };
  }

  async loginByUsername(username: string, pin?: string): Promise<{ success: boolean; message: string }> {
    if (!username || !username.trim()) {
      return { success: false, message: 'Please enter your email or Employee ID.' };
    }
    const typed = username.trim().toLowerCase();
    const employees = await this.db.getEmployees();
    // Team members can sign in with their email or their Employee ID
    const match = employees.find(
      (e) => e.active && (e.id.trim().toLowerCase() === typed || e.email.trim().toLowerCase() === typed)
    );
    if (!match) {
      return { success: false, message: 'Email or Employee ID not found. Please check and try again.' };
    }
    return this.loginUser(match.id, pin);
  }

  async loginAdmin(pin: string): Promise<{ success: boolean; message: string }> {
    const settings = await this.db.getSettings();
    const targetAdminPin = settings.adminPin || 'admin123';

    if (!pin || pin.trim() !== targetAdminPin.trim()) {
      return { success: false, message: 'Incorrect Admin PIN. Access denied.' };
    }

    // Find the primary admin employee
    const employees = await this.db.getEmployees();
    const adminEmployee = employees.find((e) => e.role === 'admin') || employees[0];

    this.currentUser.set(adminEmployee);
    this.isLoggedIn.set(true);
    this.isAdmin.set(true);

    this.saveSession({
      employeeId: adminEmployee.id,
      role: 'admin',
      isAdminMode: true,
      timestamp: Date.now(),
    });

    return { success: true, message: 'Admin authenticated successfully!' };
  }

  async changeCurrentUserPin(newPin: string, currentPin?: string): Promise<{ success: boolean; message: string }> {
    const user = this.currentUser();
    if (!user) {
      return { success: false, message: 'No active session found.' };
    }

    const cleanPin = newPin ? newPin.trim() : '';
    if (!cleanPin || cleanPin.length < 4) {
      return { success: false, message: 'New PIN must be at least 4 characters.' };
    }
    if (cleanPin.toLowerCase() === AuthService.starterPinFor(user.name)) {
      return { success: false, message: `Your new PIN can't be your starting PIN (${AuthService.starterPinFor(user.name)}). Please type a different one.` };
    }

    const existingPin = user.pin ? user.pin.trim() : '';
    if (existingPin !== '') {
      if (!currentPin || currentPin.trim().toLowerCase() !== existingPin.toLowerCase()) {
        return { success: false, message: 'Current PIN is incorrect.' };
      }
    }

    const updatedUser: Employee = {
      ...user,
      pin: cleanPin,
    };

    try {
      await this.db.saveEmployee(updatedUser);
    } catch (e) {
      console.error('PIN change not saved:', e);
      return { success: false, message: 'Could not save your new PIN. Check your internet connection and try again.' };
    }
    this.currentUser.set(updatedUser);
    this.mustChangePin.set(false);
    // Remember on this device that the PIN was changed, even if the save above
    // didn't fully reach the cloud — so this device never re-asks for this person.
    this.markPinConfirmed(user.id);

    return { success: true, message: 'PIN updated successfully!' };
  }

  logout(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
    this.currentUser.set(null);
    this.isLoggedIn.set(false);
    this.isAdmin.set(false);
    this.mustChangePin.set(false);
  }

  private saveSession(session: StoredSession): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  }
}
