import { Injectable, signal } from '@angular/core';
import { OfflineStorageService } from './offline-storage.service';
import { Employee, UserRole } from '../models/time-tracker.models';

const SESSION_KEY = 'timetracker_auth_session';

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

  constructor(private offlineStorage: OfflineStorageService) {
    this.restoreSession();
  }

  async restoreSession(): Promise<void> {
    try {
      if (typeof window === 'undefined') return;

      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session: StoredSession = JSON.parse(raw);
        const employee = await this.offlineStorage.getEmployeeById(session.employeeId);
        if (employee && employee.active) {
          const isAdminUser = session.isAdminMode || employee.role === 'admin';
          this.currentUser.set(employee);
          this.isLoggedIn.set(true);
          this.isAdmin.set(isAdminUser);
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
    const employee = await this.offlineStorage.getEmployeeById(employeeId);
    if (!employee || !employee.active) {
      return { success: false, message: 'Employee not found or inactive.' };
    }

    // PIN validation:
    const employeePin = employee.pin?.trim() ?? '';
    if (employeePin !== '') {
      if (!pin || pin.trim() !== employeePin) {
        return { success: false, message: 'Invalid employee PIN code.' };
      }
    }

    const isAdminUser = employee.role === 'admin';
    this.currentUser.set(employee);
    this.isLoggedIn.set(true);
    this.isAdmin.set(isAdminUser);

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
      return { success: false, message: 'Please enter your username.' };
    }
    const employees = await this.offlineStorage.getEmployees();
    const match = employees.find(
      (e) => e.active && e.name.trim().toLowerCase() === username.trim().toLowerCase()
    );
    if (!match) {
      return { success: false, message: 'Username not found. Please check your name.' };
    }
    return this.loginUser(match.id, pin);
  }

  async loginAdmin(pin: string): Promise<{ success: boolean; message: string }> {
    const settings = await this.offlineStorage.getSettings();
    const targetAdminPin = settings.adminPin || 'admin123';

    if (!pin || pin.trim() !== targetAdminPin.trim()) {
      return { success: false, message: 'Incorrect Admin PIN. Access denied.' };
    }

    // Find the primary admin employee
    const employees = await this.offlineStorage.getEmployees();
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
      return { success: false, message: 'New PIN must be at least 4 digits.' };
    }

    const existingPin = user.pin ? user.pin.trim() : '';
    if (existingPin !== '') {
      if (!currentPin || currentPin.trim() !== existingPin) {
        return { success: false, message: 'Current PIN is incorrect.' };
      }
    }

    const updatedUser: Employee = {
      ...user,
      pin: cleanPin,
    };

    await this.offlineStorage.saveEmployee(updatedUser);
    this.currentUser.set(updatedUser);

    return { success: true, message: 'PIN updated successfully!' };
  }

  logout(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
    this.currentUser.set(null);
    this.isLoggedIn.set(false);
    this.isAdmin.set(false);
  }

  private saveSession(session: StoredSession): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  }
}
