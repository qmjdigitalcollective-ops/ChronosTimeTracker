import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { SupabaseSyncService } from '../../services/google-sync.service';
import { TimerService } from '../../services/timer.service';
import { FormatDurationPipe } from '../../pipes/format-duration.pipe';
import {
  Employee,
  Client,
  TimeEntry,
  ScreenshotRecord,
  AppSettings,
  EmployeeReportSummary,
  ClientReportSummary,
  UserRole,
} from '../../models/time-tracker.models';

type AdminTab = 'records' | 'employees' | 'clients' | 'reports' | 'gallery' | 'settings';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, FormatDurationPipe],
  template: `
    <div class="admin-page">
      <!-- Admin Top Bar & Tabs -->
      <div class="admin-header">
        <div>
          <h2 class="admin-title">Admin Management Portal</h2>
          <p class="admin-subtitle">Master records, employee rates, clients, screenshots & payroll analytics</p>
        </div>

        <div class="admin-tabs">
          <button
            type="button"
            class="tab-btn"
            [class.active]="activeTab() === 'records'"
            (click)="activeTab.set('records')"
          >
            📋 Records ({{ entries().length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            [class.active]="activeTab() === 'employees'"
            (click)="activeTab.set('employees')"
          >
            👥 Employees ({{ employees().length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            [class.active]="activeTab() === 'clients'"
            (click)="activeTab.set('clients')"
          >
            🏢 Clients ({{ clients().length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            [class.active]="activeTab() === 'reports'"
            (click)="activeTab.set('reports')"
          >
            📊 Payroll Reports
          </button>
          <button
            type="button"
            class="tab-btn"
            [class.active]="activeTab() === 'gallery'"
            (click)="activeTab.set('gallery')"
          >
            🖼️ Screenshot Gallery ({{ screenshots().length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            [class.active]="activeTab() === 'settings'"
            (click)="activeTab.set('settings')"
          >
            ⚙️ App Settings
          </button>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-icon blue">⏱️</div>
          <div class="metric-info">
            <span class="metric-label">Total Time Tracked</span>
            <span class="metric-value">{{ totalTrackedSeconds() | formatDuration }}</span>
            <span class="metric-sub">{{ (totalTrackedSeconds() / 3600).toFixed(1) }} total billable hours</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon green">💵</div>
          <div class="metric-info">
            <span class="metric-label">Total Payroll Expense</span>
            <span class="metric-value">\${{ totalPayrollExpense() | number:'1.2-2' }}</span>
            <span class="metric-sub">Across all employees & shifts</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon purple">👥</div>
          <div class="metric-info">
            <span class="metric-label">Active Staff</span>
            <span class="metric-value">{{ employees().length }} Employees</span>
            <span class="metric-sub">{{ clients().length }} Active Clients</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon orange">📸</div>
          <div class="metric-info">
            <span class="metric-label">Screenshots Audited</span>
            <span class="metric-value">{{ screenshots().length }} Images</span>
            <span class="metric-sub">Auto-captured every {{ settings()?.screenshotIntervalMinutes || 10 }}m</span>
          </div>
        </div>
      </div>

      <!-- TAB 1: ALL TIME RECORDS -->
      @if (activeTab() === 'records') {
        <div class="content-panel">
          <div class="panel-header">
            <div class="filters-wrap">
              <input
                type="text"
                class="search-input"
                placeholder="Search tasks, employees, clients..."
                [ngModel]="searchQuery()"
                (ngModelChange)="searchQuery.set($event)"
              />

              <select
                class="filter-select"
                [ngModel]="selectedFilterEmployee()"
                (ngModelChange)="selectedFilterEmployee.set($event)"
              >
                <option value="ALL">All Employees</option>
                @for (emp of employees(); track emp.id) {
                  <option [value]="emp.id">{{ emp.name }}</option>
                }
              </select>

              <select
                class="filter-select"
                [ngModel]="selectedFilterClient()"
                (ngModelChange)="selectedFilterClient.set($event)"
              >
                <option value="ALL">All Clients</option>
                @for (cli of clients(); track cli.id) {
                  <option [value]="cli.id">{{ cli.name }}</option>
                }
              </select>
            </div>

            <div class="panel-actions">
              <button type="button" class="action-btn" (click)="exportRecordsCSV()">
                <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Export CSV
              </button>
            </div>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Employee</th>
                  <th>Client</th>
                  <th>Task Description</th>
                  <th>Duration</th>
                  <th>Rate ($/hr)</th>
                  <th>Total Pay ($)</th>
                  <th>Screenshots</th>
                  <th>Sync Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of filteredEntries(); track entry.id) {
                  <tr>
                    <td>
                      <div class="date-cell">{{ formatDate(entry.startTime) }}</div>
                      <div class="time-sub">{{ formatTime(entry.startTime) }} - {{ entry.endTime ? formatTime(entry.endTime) : 'In progress' }}</div>
                    </td>
                    <td>
                      <div class="emp-badge">
                        <span class="emp-name">{{ entry.employeeName }}</span>
                      </div>
                    </td>
                    <td>
                      <span class="client-badge">{{ entry.clientName }}</span>
                    </td>
                    <td class="task-cell-main" title="{{ entry.taskDescription }}">
                      {{ entry.taskDescription }}
                    </td>
                    <td class="duration-num">
                      {{ entry.durationSeconds | formatDuration }}
                      <span class="hours-sub">({{ (entry.durationSeconds / 3600).toFixed(2) }}h)</span>
                    </td>
                    <td class="rate-num">\${{ entry.hourlyRate }}/hr</td>
                    <td class="pay-num">\${{ entry.totalPay | number:'1.2-2' }}</td>
                    <td>
                      <button
                        type="button"
                        class="ss-count-btn"
                        [disabled]="entry.screenshotCount === 0"
                        (click)="viewEntryScreenshots(entry.id)"
                      >
                        📷 {{ entry.screenshotCount || 0 }} views
                      </button>
                    </td>
                    <td>
                      <span
                        class="status-tag"
                        [class.tag-synced]="entry.syncStatus === 'synced'"
                        [class.tag-pending]="entry.syncStatus !== 'synced'"
                      >
                        {{ entry.syncStatus === 'synced' ? '✅ Supabase' : '⏳ Pending' }}
                      </span>
                    </td>
                    <td>
                      <button type="button" class="del-btn" title="Delete record" (click)="deleteEntry(entry.id)">
                        ✕
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="10" class="empty-cell">No time records match your filters.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TAB 2: EMPLOYEE MANAGEMENT -->
      @if (activeTab() === 'employees') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Employee Directory & Hourly Pay Rates</h3>
              <p class="panel-sub">Manage staff profiles, permissions, and hourly compensation</p>
            </div>
            <button type="button" class="btn-primary" (click)="openAddEmployeeModal()">
              + Add Employee
            </button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Hourly Pay Rate</th>
                  <th>PIN</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (emp of employees(); track emp.id) {
                  <tr>
                    <td>
                      <div class="emp-row-info">
                        <div class="avatar-sm" [style.background]="emp.avatarColor || '#3b82f6'">
                          {{ emp.name.charAt(0) }}
                        </div>
                        <div>
                          <div class="font-bold">{{ emp.name }}</div>
                          <div class="text-xs text-muted">{{ emp.email }}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="role-pill" [class.admin]="emp.role === 'admin'">
                        {{ emp.role === 'admin' ? 'Administrator' : 'Normal User' }}
                      </span>
                    </td>
                    <td>{{ emp.department || 'General' }}</td>
                    <td>
                      <div class="rate-editor">
                        <span class="rate-large">\${{ emp.hourlyRate.toFixed(2) }}</span>
                        <span class="text-xs text-muted">/ hour</span>
                      </div>
                    </td>
                    <td>
                      <span class="pin-badge">🔑 {{ emp.pin || '1234' }}</span>
                    </td>
                    <td>
                      <span class="badge badge-active">Active</span>
                    </td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn-sm" (click)="openEditEmployeeModal(emp)">Edit</button>
                        <button type="button" class="btn-sm text-red" (click)="deleteEmployee(emp.id)">Delete</button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TAB 3: CLIENT MANAGEMENT -->
      @if (activeTab() === 'clients') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Client Directory</h3>
              <p class="panel-sub">Manage client accounts and project assignments</p>
            </div>
            <button type="button" class="btn-primary" (click)="openAddClientModal()">
              + Add Client
            </button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th>Project Code</th>
                  <th>Default Billing Rate</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (cli of clients(); track cli.id) {
                  <tr>
                    <td>
                      <div class="client-row-info">
                        <span class="color-dot" [style.background]="cli.color || '#3b82f6'"></span>
                        <span class="font-bold">{{ cli.name }}</span>
                      </div>
                    </td>
                    <td>
                      <span class="code-badge">{{ cli.code }}</span>
                    </td>
                    <td>\${{ cli.defaultRate || 0 }}/hr</td>
                    <td><span class="badge badge-active">Active</span></td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn-sm" (click)="openEditClientModal(cli)">Edit</button>
                        <button type="button" class="btn-sm text-red" (click)="deleteClient(cli.id)">Delete</button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TAB 4: PAYROLL REPORTS (HOURLY RATES & TOTALS PER EMPLOYEE) -->
      @if (activeTab() === 'reports') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Employee Compensation & Payroll Reports</h3>
              <p class="panel-sub">Calculated hours worked, hourly pay rates, and total payouts</p>
            </div>
            <button type="button" class="action-btn" (click)="exportPayrollReportCSV()">
              Download Payroll CSV
            </button>
          </div>

          <!-- Summary per Employee -->
          <div class="section-title">Hourly Breakdown by Employee</div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Employee Name</th>
                  <th>Hourly Pay Rate</th>
                  <th>Total Shifts</th>
                  <th>Total Hours Worked</th>
                  <th>Screenshots Taken</th>
                  <th>Total Compensation ($)</th>
                </tr>
              </thead>
              <tbody>
                @for (sum of employeeReports(); track sum.employeeId) {
                  <tr>
                    <td>
                      <span class="font-bold">{{ sum.employeeName }}</span>
                    </td>
                    <td>
                      <span class="rate-large">\${{ sum.hourlyRate.toFixed(2) }}/hr</span>
                    </td>
                    <td>{{ sum.totalEntries }} shifts</td>
                    <td class="duration-num">
                      {{ sum.totalSeconds | formatDuration }}
                      <span class="hours-sub">({{ sum.totalHours.toFixed(2) }} hrs)</span>
                    </td>
                    <td>📷 {{ sum.screenshotCount }}</td>
                    <td class="pay-num font-bold">\${{ sum.totalPay | number:'1.2-2' }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="empty-cell">No shift data recorded yet.</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr class="tfoot-row">
                  <td><strong>TOTALS</strong></td>
                  <td>-</td>
                  <td><strong>{{ entries().length }} shifts</strong></td>
                  <td><strong>{{ totalTrackedSeconds() | formatDuration }}</strong></td>
                  <td><strong>{{ screenshots().length }}</strong></td>
                  <td class="pay-num"><strong>\${{ totalPayrollExpense() | number:'1.2-2' }}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Summary per Client -->
          <div class="section-title" style="margin-top: 2rem;">Billing Breakdown by Client</div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Total Shifts</th>
                  <th>Total Hours Billed</th>
                  <th>Total Amount ($)</th>
                </tr>
              </thead>
              <tbody>
                @for (cSum of clientReports(); track cSum.clientId) {
                  <tr>
                    <td class="font-bold">{{ cSum.clientName }}</td>
                    <td>{{ cSum.totalEntries }}</td>
                    <td class="duration-num">
                      {{ cSum.totalSeconds | formatDuration }}
                      <span class="hours-sub">({{ cSum.totalHours.toFixed(2) }} hrs)</span>
                    </td>
                    <td class="pay-num">\${{ cSum.totalCost | number:'1.2-2' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TAB 5: SCREENSHOT AUDIT GALLERY -->
      @if (activeTab() === 'gallery') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Screenshot Audit Gallery</h3>
              <p class="panel-sub">Visual inspection of work in progress captured every 10 minutes</p>
            </div>
            <div class="filters-wrap">
              <select
                class="filter-select"
                [ngModel]="galleryFilterEmployee()"
                (ngModelChange)="galleryFilterEmployee.set($event)"
              >
                <option value="ALL">All Staff</option>
                @for (emp of employees(); track emp.id) {
                  <option [value]="emp.id">{{ emp.name }}</option>
                }
              </select>
            </div>
          </div>

          <div class="gallery-grid">
            @for (ss of filteredScreenshots(); track ss.id) {
              <div class="gallery-card" (click)="openScreenshotModal(ss)">
                <div class="gallery-img-wrap">
                  <img [src]="ss.thumbnailDataUrl || ss.imageDataUrl" alt="Snapshot" loading="lazy" />
                  <span class="gallery-zoom-icon">🔍</span>
                </div>
                <div class="gallery-card-body">
                  <div class="gallery-card-header">
                    <span class="gallery-emp">{{ ss.employeeName }}</span>
                    <span class="gallery-time">{{ formatTime(ss.timestamp) }}</span>
                  </div>
                  <div class="gallery-date">{{ formatDate(ss.timestamp) }}</div>
                  @if (ss.synced) {
                    <span class="synced-tag">✅ Synced to Supabase</span>
                  }
                </div>
              </div>
            } @empty {
              <div class="empty-gallery">
                <svg viewBox="0 0 24 24" width="48" height="48" stroke="#64748b" stroke-width="1.5" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <p>No screenshots recorded for this filter yet.</p>
              </div>
            }
          </div>
        </div>
      }

      <!-- TAB 6: APP SETTINGS -->
      @if (activeTab() === 'settings') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">App Settings</h3>
              <p class="panel-sub">Configure screenshot frequency, admin security, and data backup</p>
            </div>
          </div>

          <div class="settings-form">
            <!-- Screenshot Frequency -->
            <div class="setting-item">
              <div class="setting-label-col">
                <label class="setting-title">Screenshot Capture Frequency</label>
                <p class="setting-desc">How often the application takes an automatic screenshot of the active user's desktop.</p>
              </div>
              <div class="setting-input-col">
                <select
                  class="form-select-lg"
                  [ngModel]="settings()?.screenshotIntervalMinutes"
                  (ngModelChange)="onIntervalChange($event)"
                >
                  <option [value]="1">Every 1 minute (Fast Testing Mode)</option>
                  <option [value]="5">Every 5 minutes</option>
                  <option [value]="10">Every 10 minutes (Recommended Default)</option>
                  <option [value]="15">Every 15 minutes</option>
                  <option [value]="30">Every 30 minutes</option>
                  <option [value]="60">Every 60 minutes</option>
                </select>
              </div>
            </div>

            <!-- Auto Sync Toggle -->
            <div class="setting-item">
              <div class="setting-label-col">
                <label class="setting-title">Auto-Sync to Supabase</label>
                <p class="setting-desc">Automatically mark time entries as synced in Supabase whenever you are online.</p>
              </div>
              <div class="setting-input-col">
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    [ngModel]="settings()?.autoSync"
                    (ngModelChange)="onAutoSyncChange($event)"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- Admin PIN Change -->
            <div class="setting-item">
              <div class="setting-label-col">
                <label class="setting-title">Change Admin PIN</label>
                <p class="setting-desc">Update the master administrator PIN used to unlock the Admin Dashboard.</p>
              </div>
              <div class="setting-input-col">
                <div class="input-with-button">
                  <input
                    type="password"
                    class="form-input-lg"
                    placeholder="Enter new Admin PIN"
                    [(ngModel)]="newAdminPin"
                    autocomplete="new-password"
                    maxlength="20"
                  />
                  <button
                    type="button"
                    class="btn-test"
                    [disabled]="!newAdminPin.trim()"
                    (click)="saveAdminPin()"
                  >
                    Save PIN
                  </button>
                </div>
                @if (pinSaved()) {
                  <div class="test-feedback success">✓ Admin PIN updated successfully!</div>
                }
              </div>
            </div>

            <!-- Supabase Info Card -->
            <div class="script-guide-box">
              <div class="guide-header">
                <div>
                  <h4 class="guide-title">⚡ Supabase Postgres — Your Cloud Database</h4>
                  <p class="guide-sub">All data is stored in Supabase Postgres database with offline persistence. Changes sync automatically when you are online.</p>
                </div>
              </div>
              <ul class="steps-list">
                <li>Employees, clients, time entries and screenshots are stored in <strong>Supabase tables</strong>.</li>
                <li>Offline local cache ensures the app works without internet.</li>
                <li>When reconnected, pending entries are automatically marked as <strong>synced</strong>.</li>
                <li>Manage your data in your <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">Supabase Dashboard</a>.</li>
              </ul>
            </div>

            <!-- Backup & Restore -->
            <div class="backup-section">
              <h4 class="section-title">Local Database Backup &amp; Restore</h4>
              <p class="text-xs text-muted">Export a full JSON snapshot of all Firestore data or import from a previous backup.</p>
              <div class="backup-btn-row">
                <button type="button" class="btn-sm" (click)="exportBackup()">💾 Export JSON Backup</button>
                <label class="btn-sm btn-upload">
                  📁 Import JSON Backup
                  <input type="file" accept=".json" (change)="importBackup($event)" style="display: none;" />
                </label>
              </div>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- ADD/EDIT EMPLOYEE MODAL -->
    @if (showEmployeeModal()) {
      <div class="modal-overlay" (click)="showEmployeeModal.set(false)">
        <div class="modal-content-sm" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>{{ editingEmployee() ? 'Edit Employee' : 'Add New Employee' }}</h3>
            <button class="modal-close" (click)="showEmployeeModal.set(false)">✕</button>
          </div>
          <div class="modal-body-form">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" class="form-input" [(ngModel)]="employeeForm.name" placeholder="e.g. John Doe" />
            </div>
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" class="form-input" [(ngModel)]="employeeForm.email" placeholder="e.g. john@example.com" />
            </div>
            <div class="form-group">
              <label class="form-label">Hourly Pay Rate ($ / hour)</label>
              <input type="number" class="form-input" [(ngModel)]="employeeForm.hourlyRate" min="0" step="1" />
            </div>
            <div class="form-group">
              <label class="form-label">Role</label>
              <select class="form-select" [(ngModel)]="employeeForm.role">
                <option value="user">Normal User (Time Tracking Only)</option>
                <option value="admin">Administrator (Full Access & Reports)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Department</label>
              <input type="text" class="form-input" [(ngModel)]="employeeForm.department" placeholder="e.g. Engineering, Design" />
            </div>
            <div class="form-group">
              <label class="form-label">Employee Login PIN Code</label>
              <input
                type="text"
                class="form-input"
                [(ngModel)]="employeeForm.pin"
                placeholder="4-digit PIN (e.g. 1234)"
                maxlength="10"
              />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-cancel" (click)="showEmployeeModal.set(false)">Cancel</button>
            <button type="button" class="btn-save" (click)="saveEmployeeForm()">Save Employee</button>
          </div>
        </div>
      </div>
    }

    <!-- ADD/EDIT CLIENT MODAL -->
    @if (showClientModal()) {
      <div class="modal-overlay" (click)="showClientModal.set(false)">
        <div class="modal-content-sm" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>{{ editingClient() ? 'Edit Client' : 'Add New Client' }}</h3>
            <button class="modal-close" (click)="showClientModal.set(false)">✕</button>
          </div>
          <div class="modal-body-form">
            <div class="form-group">
              <label class="form-label">Client Name</label>
              <input type="text" class="form-input" [(ngModel)]="clientForm.name" placeholder="e.g. Acme Corporation" />
            </div>
            <div class="form-group">
              <label class="form-label">Project Code (2-4 uppercase chars)</label>
              <input type="text" class="form-input" [(ngModel)]="clientForm.code" placeholder="e.g. ACM" />
            </div>
            <div class="form-group">
              <label class="form-label">Default Hourly Rate ($/hr)</label>
              <input type="number" class="form-input" [(ngModel)]="clientForm.defaultRate" min="0" />
            </div>
            <div class="form-group">
              <label class="form-label">Color Code</label>
              <input type="color" class="form-input-color" [(ngModel)]="clientForm.color" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-cancel" (click)="showClientModal.set(false)">Cancel</button>
            <button type="button" class="btn-save" (click)="saveClientForm()">Save Client</button>
          </div>
        </div>
      </div>
    }

    <!-- SCREENSHOT MODAL -->
    @if (selectedScreenshot()) {
      <div class="modal-overlay" (click)="selectedScreenshot.set(null)">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <h3>Screenshot Audit Preview</h3>
              <p class="modal-meta">
                Captured at {{ formatDateTime(selectedScreenshot()!.timestamp) }} • {{ selectedScreenshot()!.employeeName }}
              </p>
            </div>
            <button class="modal-close" (click)="selectedScreenshot.set(null)">✕</button>
          </div>
          <div class="modal-body">
            <img [src]="selectedScreenshot()!.imageDataUrl" alt="Full Screenshot" />
          </div>
          <div class="modal-footer">
            <a
              [href]="selectedScreenshot()!.imageDataUrl"
              download="screenshot_{{ selectedScreenshot()!.timestamp }}.jpg"
              class="download-btn"
            >
              Download Image
            </a>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .admin-page {
      max-width: 1240px;
      margin: 1.5rem auto;
      padding: 0 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      color: #f8fafc;
    }
    .admin-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .admin-title {
      font-size: 1.65rem;
      font-weight: 700;
      margin: 0;
      letter-spacing: -0.02em;
    }
    .admin-subtitle {
      font-size: 0.88rem;
      color: #94a3b8;
      margin: 4px 0 0 0;
    }
    .admin-tabs {
      display: flex;
      gap: 6px;
      background: #1e293b;
      padding: 4px;
      border-radius: 12px;
      border: 1px solid #334155;
      flex-wrap: wrap;
    }
    .tab-btn {
      padding: 8px 14px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #94a3b8;
      background: transparent;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      color: #f8fafc;
    }
    .tab-btn.active {
      background: #3b82f6;
      color: white;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1rem;
    }
    .metric-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .metric-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
    }
    .metric-icon.blue { background: rgba(59, 130, 246, 0.15); }
    .metric-icon.green { background: rgba(16, 185, 129, 0.15); }
    .metric-icon.purple { background: rgba(139, 92, 246, 0.15); }
    .metric-icon.orange { background: rgba(245, 158, 11, 0.15); }
    .metric-info {
      display: flex;
      flex-direction: column;
    }
    .metric-label {
      font-size: 0.78rem;
      color: #94a3b8;
      font-weight: 500;
    }
    .metric-value {
      font-size: 1.4rem;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -0.02em;
      margin: 2px 0;
    }
    .metric-sub {
      font-size: 0.72rem;
      color: #64748b;
    }
    .content-panel {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .panel-heading {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0;
    }
    .panel-sub {
      font-size: 0.82rem;
      color: #94a3b8;
      margin: 3px 0 0 0;
    }
    .filters-wrap {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .search-input, .filter-select {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 12px;
      color: #f8fafc;
      font-size: 0.85rem;
      outline: none;
    }
    .search-input {
      min-width: 240px;
    }
    .action-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: #0f172a;
      border: 1px solid #334155;
      color: #e2e8f0;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .action-btn:hover {
      background: #334155;
    }
    .btn-primary {
      background: #2563eb;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-primary:hover {
      background: #1d4ed8;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
      text-align: left;
    }
    .data-table th {
      padding: 12px 14px;
      color: #94a3b8;
      border-bottom: 1px solid #334155;
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .data-table td {
      padding: 12px 14px;
      border-bottom: 1px solid #1e293b;
      color: #cbd5e1;
    }
    .data-table tr:hover td {
      background: rgba(255,255,255,0.02);
    }
    .date-cell {
      font-weight: 600;
      color: #f8fafc;
    }
    .time-sub {
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .emp-badge {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .emp-name {
      font-weight: 600;
      color: #f8fafc;
    }
    .client-badge {
      background: #0f172a;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      color: #38bdf8;
    }
    .task-cell-main {
      max-width: 220px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .duration-num {
      font-family: monospace;
      font-weight: 600;
    }
    .hours-sub {
      font-size: 0.72rem;
      color: #94a3b8;
      margin-left: 4px;
    }
    .rate-num {
      font-weight: 600;
      color: #cbd5e1;
    }
    .pay-num {
      font-weight: 700;
      color: #10b981;
    }
    .ss-count-btn {
      background: #0f172a;
      border: 1px solid #334155;
      color: #94a3b8;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .ss-count-btn:hover:not(:disabled) {
      color: #38bdf8;
      border-color: #38bdf8;
    }
    .status-tag {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .tag-synced {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .tag-pending {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .del-btn {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      font-size: 0.9rem;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .del-btn:hover {
      color: #ef4444;
      background: rgba(239,68,68,0.1);
    }
    .empty-cell {
      text-align: center;
      padding: 3rem;
      color: #64748b;
    }
    .emp-row-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .avatar-sm {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: white;
      font-size: 0.9rem;
    }
    .role-pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      background: #0f172a;
      color: #94a3b8;
    }
    .role-pill.admin {
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    .rate-large {
      font-size: 1rem;
      font-weight: 700;
      color: #10b981;
    }
    .badge-active {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .pin-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #0f172a;
      border: 1px solid #334155;
      padding: 3px 8px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.8rem;
      color: #38bdf8;
      letter-spacing: 0.05em;
    }
    .row-actions {
      display: flex;
      gap: 8px;
    }
    .btn-sm {
      background: #0f172a;
      border: 1px solid #334155;
      color: #cbd5e1;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .btn-sm:hover {
      background: #334155;
      color: white;
    }
    .text-red {
      color: #f87171;
    }
    .text-red:hover {
      border-color: #ef4444;
    }
    .client-row-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .color-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .code-badge {
      background: #0f172a;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 0.78rem;
      color: #38bdf8;
    }
    .section-title {
      font-size: 1.05rem;
      font-weight: 700;
      margin: 1.25rem 0 0.75rem 0;
      color: #f8fafc;
    }
    .tfoot-row td {
      border-top: 2px solid #334155;
      font-size: 0.95rem;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1.25rem;
    }
    .gallery-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .gallery-card:hover {
      transform: translateY(-2px);
      border-color: #38bdf8;
    }
    .gallery-img-wrap {
      position: relative;
      height: 140px;
      background: #020617;
      overflow: hidden;
    }
    .gallery-img-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .gallery-zoom-icon {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(15, 23, 42, 0.7);
      padding: 4px;
      border-radius: 6px;
      font-size: 0.8rem;
    }
    .gallery-card-body {
      padding: 10px 12px;
    }
    .gallery-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2px;
    }
    .gallery-emp {
      font-weight: 600;
      font-size: 0.85rem;
      color: #f8fafc;
    }
    .gallery-time {
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .gallery-date {
      font-size: 0.75rem;
      color: #64748b;
    }
    .drive-link {
      display: inline-block;
      margin-top: 6px;
      font-size: 0.72rem;
      color: #38bdf8;
      text-decoration: none;
    }
    .drive-link:hover {
      text-decoration: underline;
    }
    .empty-gallery {
      grid-column: 1 / -1;
      text-align: center;
      padding: 4rem 1rem;
      color: #64748b;
    }
    .settings-form {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .setting-item {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid #334155;
    }
    @media (max-width: 768px) {
      .setting-item {
        grid-template-columns: 1fr;
      }
    }
    .setting-title {
      font-weight: 600;
      font-size: 0.95rem;
      color: #f8fafc;
    }
    .setting-desc {
      font-size: 0.82rem;
      color: #94a3b8;
      margin: 4px 0 0 0;
    }
    .form-select-lg, .form-input-lg {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 14px;
      color: #f8fafc;
      font-size: 0.9rem;
      outline: none;
    }
    .input-with-button {
      display: flex;
      gap: 8px;
    }
    .btn-test {
      background: #334155;
      color: white;
      border: 1px solid #475569;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-test:hover:not(:disabled) {
      background: #475569;
    }
    .test-feedback {
      margin-top: 8px;
      font-size: 0.8rem;
      padding: 8px 12px;
      border-radius: 6px;
    }
    .test-feedback.success {
      background: rgba(16,185,129,0.15);
      color: #34d399;
      border: 1px solid rgba(16,185,129,0.3);
    }
    .test-feedback.error {
      background: rgba(239,68,68,0.15);
      color: #f87171;
      border: 1px solid rgba(239,68,68,0.3);
    }
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 26px;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background-color: #334155;
      transition: 0.2s;
      border-radius: 34px;
    }
    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: 0.2s;
      border-radius: 50%;
    }
    input:checked + .toggle-slider {
      background-color: #10b981;
    }
    input:checked + .toggle-slider:before {
      transform: translateX(22px);
    }
    .script-guide-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.5rem;
    }
    .guide-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .guide-title {
      font-size: 1rem;
      font-weight: 700;
      margin: 0;
      color: #f8fafc;
    }
    .guide-sub {
      font-size: 0.8rem;
      color: #94a3b8;
      margin: 2px 0 0 0;
    }
    .btn-copy-code {
      background: #2563eb;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-copy-code:hover {
      background: #1d4ed8;
    }
    .steps-list {
      margin: 0;
      padding-left: 1.25rem;
      font-size: 0.85rem;
      color: #cbd5e1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .steps-list a {
      color: #38bdf8;
      text-decoration: underline;
    }
    .backup-section {
      padding-top: 1rem;
    }
    .backup-btn-row {
      display: flex;
      gap: 10px;
      margin-top: 8px;
    }
    .btn-upload {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: 1.5rem;
    }
    .modal-content-sm {
      background: #1e293b;
      border-radius: 14px;
      border: 1px solid #475569;
      max-width: 480px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .modal-body-form {
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #cbd5e1;
    }
    .form-input, .form-select {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 12px;
      color: #f8fafc;
      font-size: 0.88rem;
      outline: none;
    }
    .form-input-color {
      height: 40px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      cursor: pointer;
      width: 100%;
      padding: 2px 6px;
    }
    .modal-footer {
      padding: 0.85rem 1.5rem;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      border-top: 1px solid #334155;
      background: #1e293b;
    }
    .btn-cancel {
      background: #334155;
      color: #cbd5e1;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .btn-save {
      background: #2563eb;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .modal-content {
      background: #1e293b;
      border-radius: 16px;
      border: 1px solid #475569;
      max-width: 900px;
      width: 100%;
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid #334155;
    }
    .modal-header h3 {
      margin: 0;
      font-size: 1.1rem;
      color: #f8fafc;
    }
    .modal-meta {
      margin: 4px 0 0 0;
      font-size: 0.8rem;
      color: #94a3b8;
    }
    .modal-close {
      background: none;
      border: none;
      color: #cbd5e1;
      font-size: 1.25rem;
      cursor: pointer;
    }
    .modal-body {
      padding: 1rem;
      max-height: 65vh;
      overflow: auto;
      text-align: center;
      background: #0f172a;
    }
    .modal-body img {
      max-width: 100%;
      max-height: 60vh;
      border-radius: 8px;
      border: 1px solid #334155;
    }
    .download-btn {
      background: #2563eb;
      color: white;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
    }
  `],
})
export class AdminDashboardComponent implements OnInit {
  activeTab = signal<AdminTab>('records');

  employees = signal<Employee[]>([]);
  clients = signal<Client[]>([]);
  entries = signal<TimeEntry[]>([]);
  screenshots = signal<ScreenshotRecord[]>([]);
  settings = signal<AppSettings | null>(null);
  selectedScreenshot = signal<ScreenshotRecord | null>(null);

  // Filters
  searchQuery = signal<string>('');
  selectedFilterEmployee = signal<string>('ALL');
  selectedFilterClient = signal<string>('ALL');
  galleryFilterEmployee = signal<string>('ALL');

  // Modals & Forms
  showEmployeeModal = signal<boolean>(false);
  editingEmployee = signal<Employee | null>(null);
  employeeForm = {
    name: '',
    email: '',
    hourlyRate: 35,
    role: 'user' as UserRole,
    department: '',
    pin: '1234',
  };

  showClientModal = signal<boolean>(false);
  editingClient = signal<Client | null>(null);
  clientForm = {
    name: '',
    code: '',
    defaultRate: 50,
    color: '#3b82f6',
  };

  newAdminPin = '';
  pinSaved = signal<boolean>(false);

  constructor(
    private offlineStorage: OfflineStorageService,
    private supabaseSync: SupabaseSyncService,
    private timerService: TimerService,
    public authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.refreshAllData();
  }

  async refreshAllData(): Promise<void> {
    const [emps, clis, ents, sss, sets] = await Promise.all([
      this.offlineStorage.getEmployees(),
      this.offlineStorage.getClients(),
      this.offlineStorage.getTimeEntries(),
      this.offlineStorage.getScreenshots(),
      this.offlineStorage.getSettings(),
    ]);

    this.employees.set(emps);
    this.clients.set(clis);
    this.entries.set(ents);
    this.screenshots.set(sss);
    this.settings.set(sets);
  }

  // --- Computed Metrics ---

  totalTrackedSeconds(): number {
    return this.entries().reduce((acc, curr) => acc + curr.durationSeconds, 0);
  }

  totalPayrollExpense(): number {
    return this.entries().reduce((acc, curr) => acc + (curr.totalPay || 0), 0);
  }

  filteredEntries(): TimeEntry[] {
    const q = this.searchQuery().toLowerCase().trim();
    const empFilter = this.selectedFilterEmployee();
    const cliFilter = this.selectedFilterClient();

    return this.entries().filter((e) => {
      const matchEmp = empFilter === 'ALL' || e.employeeId === empFilter;
      const matchCli = cliFilter === 'ALL' || e.clientId === cliFilter;
      const matchSearch =
        !q ||
        e.employeeName.toLowerCase().includes(q) ||
        e.clientName.toLowerCase().includes(q) ||
        e.taskDescription.toLowerCase().includes(q);

      return matchEmp && matchCli && matchSearch;
    });
  }

  filteredScreenshots(): ScreenshotRecord[] {
    const emp = this.galleryFilterEmployee();
    if (emp === 'ALL') return this.screenshots();
    return this.screenshots().filter((s) => s.employeeId === emp);
  }

  employeeReports(): EmployeeReportSummary[] {
    const map = new Map<string, EmployeeReportSummary>();

    for (const emp of this.employees()) {
      map.set(emp.id, {
        employeeId: emp.id,
        employeeName: emp.name,
        hourlyRate: emp.hourlyRate,
        totalEntries: 0,
        totalSeconds: 0,
        totalHours: 0,
        totalPay: 0,
        screenshotCount: 0,
      });
    }

    for (const entry of this.entries()) {
      const rep = map.get(entry.employeeId);
      if (rep) {
        rep.totalEntries++;
        rep.totalSeconds += entry.durationSeconds;
        rep.totalPay += entry.totalPay || 0;
        rep.screenshotCount += entry.screenshotCount || 0;
      }
    }

    for (const rep of map.values()) {
      rep.totalHours = rep.totalSeconds / 3600;
    }

    return Array.from(map.values());
  }

  clientReports(): ClientReportSummary[] {
    const map = new Map<string, ClientReportSummary>();

    for (const cli of this.clients()) {
      map.set(cli.id, {
        clientId: cli.id,
        clientName: cli.name,
        totalEntries: 0,
        totalSeconds: 0,
        totalHours: 0,
        totalCost: 0,
      });
    }

    for (const entry of this.entries()) {
      const cRep = map.get(entry.clientId);
      if (cRep) {
        cRep.totalEntries++;
        cRep.totalSeconds += entry.durationSeconds;
        cRep.totalCost += entry.totalPay || 0;
      }
    }

    for (const cRep of map.values()) {
      cRep.totalHours = cRep.totalSeconds / 3600;
    }

    return Array.from(map.values());
  }

  // --- Modal Helpers ---

  openAddEmployeeModal(): void {
    this.editingEmployee.set(null);
    this.employeeForm = {
      name: '',
      email: '',
      hourlyRate: 35,
      role: 'user',
      department: '',
      pin: '1234',
    };
    this.showEmployeeModal.set(true);
  }

  openEditEmployeeModal(emp: Employee): void {
    this.editingEmployee.set(emp);
    this.employeeForm = {
      name: emp.name,
      email: emp.email,
      hourlyRate: emp.hourlyRate,
      role: emp.role,
      department: emp.department || '',
      pin: emp.pin || '1234',
    };
    this.showEmployeeModal.set(true);
  }

  async saveEmployeeForm(): Promise<void> {
    if (!this.employeeForm.name.trim()) return;

    const editing = this.editingEmployee();
    const id = editing ? editing.id : 'emp_' + Date.now();

    const emp: Employee = {
      id,
      name: this.employeeForm.name.trim(),
      email: this.employeeForm.email.trim(),
      hourlyRate: Number(this.employeeForm.hourlyRate) || 0,
      role: this.employeeForm.role,
      department: this.employeeForm.department.trim(),
      avatarColor: editing?.avatarColor || this.getRandomColor(),
      pin: this.employeeForm.pin?.trim() || editing?.pin || '1234',
      active: true,
    };

    await this.offlineStorage.saveEmployee(emp);

    // If currently logged in user is this employee, update the session user
    if (this.authService.currentUser()?.id === emp.id) {
      this.authService.currentUser.set(emp);
    }

    this.showEmployeeModal.set(false);
    await this.refreshAllData();
  }

  async deleteEmployee(id: string): Promise<void> {
    if (confirm('Are you sure you want to delete this employee?')) {
      await this.offlineStorage.deleteEmployee(id);
      await this.refreshAllData();
    }
  }

  openAddClientModal(): void {
    this.editingClient.set(null);
    this.clientForm = {
      name: '',
      code: '',
      defaultRate: 50,
      color: '#3b82f6',
    };
    this.showClientModal.set(true);
  }

  openEditClientModal(cli: Client): void {
    this.editingClient.set(cli);
    this.clientForm = {
      name: cli.name,
      code: cli.code,
      defaultRate: cli.defaultRate || 50,
      color: cli.color || '#3b82f6',
    };
    this.showClientModal.set(true);
  }

  async saveClientForm(): Promise<void> {
    if (!this.clientForm.name.trim()) return;

    const editing = this.editingClient();
    const id = editing ? editing.id : 'cli_' + Date.now();

    const cli: Client = {
      id,
      name: this.clientForm.name.trim(),
      code: this.clientForm.code.trim().toUpperCase() || 'CLI',
      defaultRate: Number(this.clientForm.defaultRate) || 0,
      color: this.clientForm.color,
      active: true,
    };

    await this.offlineStorage.saveClient(cli);
    this.showClientModal.set(false);
    await this.refreshAllData();
  }

  async deleteClient(id: string): Promise<void> {
    if (confirm('Are you sure you want to delete this client?')) {
      await this.offlineStorage.deleteClient(id);
      await this.refreshAllData();
    }
  }

  async deleteEntry(id: string): Promise<void> {
    if (confirm('Delete this time entry and its associated screenshots?')) {
      await this.offlineStorage.deleteTimeEntry(id);
      await this.refreshAllData();
    }
  }

  async viewEntryScreenshots(entryId: string): Promise<void> {
    const list = await this.offlineStorage.getScreenshots(entryId);
    if (list.length > 0) {
      this.selectedScreenshot.set(list[0]);
    }
  }

  openScreenshotModal(ss: ScreenshotRecord): void {
    this.selectedScreenshot.set(ss);
  }

  // --- Settings & Cloud Actions ---

  async onIntervalChange(val: any): Promise<void> {
    const mins = Number(val);
    const curr = this.settings();
    if (curr) {
      curr.screenshotIntervalMinutes = mins;
      await this.offlineStorage.saveSettings(curr);
      this.settings.set({ ...curr });
      this.timerService.updateIntervalMinutes(mins);
    }
  }

  async saveAdminPin(): Promise<void> {
    const pin = this.newAdminPin.trim();
    if (!pin) return;
    const curr = this.settings();
    if (curr) {
      curr.adminPin = pin;
      await this.offlineStorage.saveSettings(curr);
      this.settings.set({ ...curr });
      this.newAdminPin = '';
      this.pinSaved.set(true);
      setTimeout(() => this.pinSaved.set(false), 3000);
    }
  }

  async onAutoSyncChange(enabled: boolean): Promise<void> {
    const curr = this.settings();
    if (curr) {
      curr.autoSync = enabled;
      await this.offlineStorage.saveSettings(curr);
      this.settings.set({ ...curr });
    }
  }

  // --- CSV Export ---

  exportRecordsCSV(): void {
    const headers = [
      'Entry ID',
      'Date',
      'Employee Name',
      'Client Name',
      'Task Description',
      'Start Time',
      'End Time',
      'Duration (Seconds)',
      'Duration (Hours)',
      'Hourly Rate ($)',
      'Total Pay ($)',
      'Screenshot Count',
      'Sync Status',
    ];

    const rows = this.filteredEntries().map((e) => [
      e.id,
      new Date(e.startTime).toLocaleDateString(),
      `"${e.employeeName.replace(/"/g, '""')}"`,
      `"${e.clientName.replace(/"/g, '""')}"`,
      `"${e.taskDescription.replace(/"/g, '""')}"`,
      new Date(e.startTime).toLocaleTimeString(),
      e.endTime ? new Date(e.endTime).toLocaleTimeString() : 'In Progress',
      e.durationSeconds,
      (e.durationSeconds / 3600).toFixed(2),
      e.hourlyRate,
      e.totalPay.toFixed(2),
      e.screenshotCount || 0,
      e.syncStatus,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.downloadFile(csvContent, `time_tracker_records_${Date.now()}.csv`, 'text/csv');
  }

  exportPayrollReportCSV(): void {
    const headers = [
      'Employee ID',
      'Employee Name',
      'Hourly Rate ($)',
      'Total Shifts',
      'Total Hours Worked',
      'Screenshots Audited',
      'Total Compensation ($)',
    ];

    const rows = this.employeeReports().map((r) => [
      r.employeeId,
      `"${r.employeeName.replace(/"/g, '""')}"`,
      r.hourlyRate.toFixed(2),
      r.totalEntries,
      r.totalHours.toFixed(2),
      r.screenshotCount,
      r.totalPay.toFixed(2),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.downloadFile(csvContent, `payroll_report_${Date.now()}.csv`, 'text/csv');
  }

  async exportBackup(): Promise<void> {
    const json = await this.offlineStorage.exportAllData();
    this.downloadFile(json, `chronos_backup_${Date.now()}.json`, 'application/json');
  }

  async importBackup(event: any): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await this.offlineStorage.importData(reader.result as string);
        await this.refreshAllData();
        alert('Data imported successfully!');
      } catch (e) {
        alert('Failed to import data: ' + e);
      }
    };
    reader.readAsText(file);
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDateTime(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  private getRandomColor(): string {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
