import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { Employee } from '../../models/time-tracker.models';

type LoginMode = 'employee' | 'admin';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <!-- Logo & Branding -->
        <div class="login-header">
          <div class="brand-logo">
            <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="2.2" fill="none">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <h2 class="brand-title">TimeTrack Pro</h2>
          <p class="brand-desc">Offline Time Tracker & Automated Cloud Sync</p>
        </div>

        <!-- Login Form -->

          <form class="login-form" (submit)="onEmployeeSubmit($event)">
            <div class="form-group">
              <label class="form-label">Select Your Name</label>
              <select
                class="form-select"
                [ngModel]="selectedEmployeeId()"
                (ngModelChange)="selectedEmployeeId.set($event)"
                name="employeeId"
              >
                @for (emp of employees(); track emp.id) {
                  <option [value]="emp.id">
                    {{ emp.name }} • {{ emp.department || 'Staff' }} (\${{ emp.hourlyRate }}/hr)
                  </option>
                }
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Employee PIN Code</label>
              <input
                type="password"
                class="form-input"
                placeholder="Enter 4-digit PIN"
                [(ngModel)]="employeePin"
                name="pin"
                autocomplete="current-password"
                maxlength="10"
              />
            </div>

            @if (errorMessage()) {
              <div class="error-banner">
                ⚠️ {{ errorMessage() }}
              </div>
            }

            <button type="submit" class="btn-submit" [disabled]="loading()">
              {{ loading() ? 'Signing In...' : 'Clock In / Start Tracking' }}
            </button>
          </form>

        <div class="login-footer">
          <span class="offline-badge">
            <span class="dot"></span>
            Offline-Enabled • Ready without Internet
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 85vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .login-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 2.25rem;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
      color: #f8fafc;
    }
    .login-header {
      text-align: center;
      margin-bottom: 1.75rem;
    }
    .brand-logo {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: white;
      margin-bottom: 0.85rem;
      box-shadow: 0 8px 16px rgba(59, 130, 246, 0.35);
    }
    .brand-title {
      font-size: 1.45rem;
      font-weight: 700;
      margin: 0;
      letter-spacing: -0.02em;
    }
    .brand-desc {
      font-size: 0.82rem;
      color: #94a3b8;
      margin: 4px 0 0 0;
    }
    .tab-btn:hover {
      color: #f8fafc;
    }
    .tab-btn.active {
      background: #3b82f6;
      color: white;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
    }
    .login-form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      font-size: 0.82rem;
      font-weight: 600;
      color: #cbd5e1;
    }
    .form-label {
      font-size: 0.82rem;
      font-weight: 600;
      color: #cbd5e1;
    }
    .form-select, .form-input {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 11px 14px;
      color: #f8fafc;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .form-select:focus, .form-input:focus {
      border-color: #3b82f6;
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 500;
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 500;
    }
    .btn-submit {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: white;
      border: none;
      padding: 12px;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
      margin-top: 0.5rem;
    }
    .btn-submit:hover:not(:disabled) {
      background: linear-gradient(135deg, #1d4ed8, #1e40af);
      transform: translateY(-1px);
    }
    .btn-submit:hover:not(:disabled) {
      background: linear-gradient(135deg, #1d4ed8, #1e40af);
      transform: translateY(-1px);
    }
    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .login-footer {
      margin-top: 1.75rem;
      text-align: center;
      border-top: 1px solid #334155;
      padding-top: 1.25rem;
    }
    .offline-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .offline-badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
    }
  `],
})
export class LoginComponent implements OnInit {
  employees = signal<Employee[]>([]);
  selectedEmployeeId = signal<string>('');
  employeePin = '';
  errorMessage = signal<string | null>(null);
  loading = signal<boolean>(false);

  constructor(
    private authService: AuthService,
    private offlineStorage: OfflineStorageService
  ) {}

  async ngOnInit(): Promise<void> {
    const list = await this.offlineStorage.getEmployees();
    this.employees.set(list);
    if (list.length > 0) {
      this.selectedEmployeeId.set(list[1]?.id || list[0].id);
    }
  }

  async onEmployeeSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);
    this.loading.set(true);

    const res = await this.authService.loginUser(this.selectedEmployeeId(), this.employeePin);
    this.loading.set(false);

    if (!res.success) {
      this.errorMessage.set(res.message);
    }
  }
}
