import { Injectable, signal } from '@angular/core';
import { DataService } from './data.service';
import { Employee } from '../models/time-tracker.models';

/** Prefix for a per-device, per-employee flag: "this device already confirmed its own PIN." */
const PIN_CONFIRMED_PREFIX = 'timetracker_pin_confirmed_';

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

  /** Silently restores a session from a stored login token, if one is still valid. */
  async restoreSession(): Promise<void> {
    try {
      const result = await this.db.whoami();
      if (result) {
        this.applyLogin(result.employee, result.isAdmin);
        this.isInitialized.set(true);
        return;
      }
    } catch (e) {
      console.warn('Could not restore auth session:', e);
    }
    this.isInitialized.set(true);
  }

  private applyLogin(employee: Employee, isAdmin: boolean): void {
    this.currentUser.set(employee);
    this.isLoggedIn.set(true);
    this.isAdmin.set(isAdmin);
    this.mustChangePin.set(this.isStarterPin(employee));
  }

  async loginUser(employeeId: string, pin?: string): Promise<{ success: boolean; message: string }> {
    if (!pin) return { success: false, message: 'Invalid employee PIN code.' };
    try {
      const result = await this.db.login({ employeeId, pin });
      this.applyLogin(result.employee, result.isAdmin);
      return { success: true, message: `Welcome back, ${result.employee.name}!` };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Invalid employee PIN code.' };
    }
  }

  async loginByUsername(username: string, pin?: string): Promise<{ success: boolean; message: string }> {
    if (!username || !username.trim()) {
      return { success: false, message: 'Please enter your email or Employee ID.' };
    }
    if (!pin) return { success: false, message: 'Email or Employee ID not found. Please check and try again.' };
    try {
      const typed = username.trim();
      const result = typed.includes('@')
        ? await this.db.login({ email: typed, pin })
        : await this.db.login({ employeeId: typed, pin });
      this.applyLogin(result.employee, result.isAdmin);
      return { success: true, message: `Welcome back, ${result.employee.name}!` };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Email or Employee ID not found. Please check and try again.' };
    }
  }

  async loginAdmin(pin: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.db.loginAdmin(pin);
      this.applyLogin(result.employee, true);
      return { success: true, message: 'Admin authenticated successfully!' };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Incorrect Admin PIN. Access denied.' };
    }
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
      // The server only ever accepts the "pin" field from a non-admin editing
      // their own record — every other field is ignored, no matter what is sent.
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

  /** Clears the session immediately; telling the server happens in the background. */
  logout(): void {
    this.currentUser.set(null);
    this.isLoggedIn.set(false);
    this.isAdmin.set(false);
    this.mustChangePin.set(false);
    this.db.logout().catch(() => {
      /* the local session is already gone either way */
    });
  }
}
