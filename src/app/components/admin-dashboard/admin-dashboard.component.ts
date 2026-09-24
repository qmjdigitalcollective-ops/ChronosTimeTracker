import { Component, OnDestroy, OnInit, effect, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { DataService } from '../../services/data.service';
import { TimerService } from '../../services/timer.service';
import { FormatDurationPipe } from '../../pipes/format-duration.pipe';
import { MoneyPipe } from '../../pipes/money.pipe';
import { billRateFor, payRateFor } from '../../services/rates';
import { CURRENCY_CODE, CURRENCY_SYMBOL } from '../../app.constants';
import {
  Employee,
  Client,
  TimeEntry,
  ScreenshotRecord,
  AppSettings,
  EmployeeReportSummary,
  ClientReportSummary,
  UserRole,
  Contract,
  Payout,
  TimesheetApproval,
  MANUAL_ENTRY_PREFIX,
  MemberPermissions,
  TeamPermissionRow,
} from '../../models/time-tracker.models';
import { DEFAULT_MEMBER_PERMISSIONS, PERMISSION_LABELS, effectivePermissions } from '../../services/permissions';
import { IconComponent } from '../icon/icon.component';
import { UserTrackerComponent } from '../user-tracker/user-tracker.component';
import { PayslipComponent } from '../payslip/payslip.component';
import { NavService } from '../../services/nav.service';
import { formatPeriod, payPeriodFor, previousPayPeriod } from '../../services/pay-period';

type AdminTab =
  | 'overview'
  | 'tracker'
  | 'timesheets'
  | 'approvals'
  | 'realtime'
  | 'tracked'
  | 'earnings'
  | 'payroll'
  | 'payments'
  | 'people'
  | 'projects'
  | 'contracts'
  | 'gallery'
  | 'importExport'
  | 'settings';

type TrackedMode = 'hours' | 'pay' | 'bill';

/** Which optional columns show on View & Edit Timesheet. Date/Time/Actions always show. */
interface TimesheetColumns {
  member: boolean;
  project: boolean;
  task: boolean;
  description: boolean;
  manual: boolean;
  pay: boolean;
  bill: boolean;
}

interface TimesheetDay {
  key: string;
  label: string;
  seconds: number;
  entries: TimeEntry[];
}

interface RealTimeRow {
  employee: Employee;
  status: 'working' | 'break' | 'off';
  entry: TimeEntry | null;
  todaySeconds: number;
  lastSeen: number | null;
}

interface TrackedRow {
  key: string;
  employeeName: string;
  clientName: string;
  cells: Record<string, { seconds: number; pay: number; bill: number }>;
  total: { seconds: number; pay: number; bill: number };
}

interface PayRow {
  employeeId: string;
  employeeName: string;
  projects: string[];
  totalHours: number;
  totalPay: number;
  avgRate: number;
  payout: Payout | null;
}

type RangePreset = 'this-period' | 'last-period' | 'this-month' | 'last-month' | 'all' | 'custom';

interface ClientEarningsSummary {
  clientId: string;
  clientName: string;
  color: string;
  billRate: number; // client's default rate ($/hr) — what Auravia charges
  totalEntries: number;
  totalSeconds: number;
  totalHours: number;
  billed: number; // what Auravia receives
  teamCost: number; // what Auravia pays the team
  profit: number;
  margin: number; // 0-100
}

interface MemberClientSummary {
  key: string;
  employeeName: string;
  clientName: string;
  payRate: number;
  billRate: number;
  totalHours: number;
  billed: number;
  teamCost: number;
  profit: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, FormatDurationPipe, MoneyPipe, IconComponent, UserTrackerComponent, PayslipComponent],
  template: `
    <div class="admin-shell" [class.collapsed]="sidebarCollapsed()">
      <!-- Side menu (grouped, like WebWork). Click an item to open that page. -->
      <aside class="side-menu" [class.open]="menuOpen()">
        <button type="button" class="collapse-btn" (click)="toggleSidebar()" [title]="sidebarCollapsed() ? 'Show menu' : 'Hide menu labels'">
          <app-icon name="sidebar" [size]="17" />
          <span class="collapse-label">Hide menu</span>
        </button>
        <button type="button" class="menu-toggle" (click)="menuOpen.set(!menuOpen())">
          <span class="menu-toggle-label"><app-icon name="menu" [size]="18" /> {{ currentMenuLabel() }}</span>
          <app-icon class="chev" [class.up]="menuOpen()" name="chevron-down" [size]="18" />
        </button>
        <nav class="menu-groups">
          @for (group of menuGroups; track group.title) {
            <div class="menu-group">
              <div class="menu-title">{{ group.title }}</div>
              @for (item of group.items; track item.tab) {
                <button type="button" class="menu-item" [class.active]="activeTab() === item.tab" (click)="goTo(item.tab)" [title]="item.label">
                  <app-icon class="menu-icon" [name]="item.icon" [size]="17" />
                  <span>{{ item.label }}</span>
                  @if (item.tab === 'tracker' && timerService.status() !== 'completed') {
                    <span class="menu-badge live">{{ timerService.status() === 'active' ? 'On' : 'Paused' }}</span>
                  }
                  @if (item.tab === 'realtime' && workingNowCount() > 0) {
                    <span class="menu-badge">{{ workingNowCount() }}</span>
                  }
                </button>
              }
            </div>
          }
        </nav>
      </aside>

    <div class="admin-page">
      <div class="admin-header">
        <div>
          <h2 class="admin-title">{{ currentMenuLabel() }}</h2>
          <p class="admin-subtitle">Auravia Collective · Admin</p>
        </div>
      </div>

      <!-- HOME: overview with payday reminder -->
      @if (activeTab() === 'overview') {
        <div class="home-grid">
          <div class="payday-card" [class.soon]="paydayDaysLeft() <= 3">
            <div class="payday-top">
              <span class="eyebrow-gold"><app-icon name="bell" [size]="14" /> Next payday</span>
              <span class="payday-countdown">
                {{ paydayDaysLeft() === 0 ? 'Today' : paydayDaysLeft() === 1 ? 'Tomorrow' : 'In ' + paydayDaysLeft() + ' days' }}
              </span>
            </div>
            <div class="payday-date">{{ formatDate(currentPeriodRange()[1].getTime()) }}</div>
            <div class="payday-sub">Pay period {{ periodLabel(currentPeriodRange()) }}</div>
            <div class="payday-amount">
              <span>Team pay so far</span>
              <strong>{{ periodTotals(currentPeriodRange()).pay | money }}</strong>
            </div>
            <div class="payday-steps">
              <span><strong>{{ approvalCount(currentPeriodRange(), 'submitted') + approvalCount(currentPeriodRange(), 'approved') }}</strong> of {{ activeMembersWithTime(currentPeriodRange()) }} timesheets submitted</span>
              <span><strong>{{ approvalCount(currentPeriodRange(), 'approved') }}</strong> approved</span>
            </div>
            <div class="payday-actions">
              <button type="button" class="btn-primary" (click)="openPeriodPage('approvals', currentPeriodRange())">Review timesheets</button>
              <button type="button" class="action-btn" (click)="openPeriodPage('payroll', currentPeriodRange())">Team Pay</button>
            </div>
          </div>

          @if (unpaidLastPeriod().length > 0) {
            <div class="alert-card">
              <app-icon name="alert" [size]="18" />
              <div>
                <strong>Last period ({{ periodLabel(lastPeriodRange()) }}) isn't fully paid yet.</strong>
                <div class="text-muted">Unpaid: {{ unpaidLastPeriod().join(', ') }}</div>
              </div>
              <button type="button" class="btn-sm" (click)="openPeriodPage('payroll', lastPeriodRange())">Open</button>
            </div>
          }

          <div class="home-stats">
            <div class="metric-card">
              <div class="metric-icon"><app-icon name="clock" [size]="20" /></div>
              <div class="metric-info">
                <span class="metric-label">Hours this period</span>
                <span class="metric-value">{{ periodTotals(currentPeriodRange()).hours | number:'1.1-1' }}</span>
              </div>
            </div>
            <div class="metric-card">
              <div class="metric-icon"><app-icon name="building" [size]="20" /></div>
              <div class="metric-info">
                <span class="metric-label">Client billing</span>
                <span class="metric-value">{{ periodTotals(currentPeriodRange()).billed | money }}</span>
              </div>
            </div>
            <div class="metric-card">
              <div class="metric-icon"><app-icon name="trending" [size]="20" /></div>
              <div class="metric-info">
                <span class="metric-label">Your margin</span>
                <span class="metric-value" [class.neg]="periodTotals(currentPeriodRange()).billed - periodTotals(currentPeriodRange()).pay < 0">
                  {{ periodTotals(currentPeriodRange()).billed - periodTotals(currentPeriodRange()).pay | money }}
                </span>
              </div>
            </div>
          </div>

          <div class="content-panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-heading">Working now</h3>
                <p class="panel-sub">{{ workingNowCount() }} working · {{ onBreakCount() }} on break</p>
              </div>
              <button type="button" class="action-btn" (click)="goTo('realtime')">Real Time</button>
            </div>
            <div class="now-list">
              @for (row of realTimeRows(); track row.employee.id) {
                @if (row.status !== 'off') {
                  <div class="now-row">
                    <div class="avatar-sm" [style.background]="row.employee.avatarColor || '#a87c2c'">{{ row.employee.name.charAt(0) }}</div>
                    <div class="now-info">
                      <strong>{{ row.employee.name }}</strong>
                      <span class="text-muted">{{ row.entry?.clientName }} · {{ row.entry?.taskDescription }}</span>
                    </div>
                    <span class="rt-pill" [class.on]="row.status === 'working'" [class.break]="row.status === 'break'">
                      {{ row.status === 'working' ? 'Working' : 'On break' }}
                    </span>
                  </div>
                }
              } 
              @if (workingNowCount() + onBreakCount() === 0) {
                <p class="empty-cell" style="padding: 1.5rem;">Nobody is tracking time right now.</p>
              }
            </div>
          </div>
        </div>
      }

      <!-- MY TIMER (your own time tracking) -->
      @if (activeTab() === 'tracker') {
        <app-user-tracker />
      }

      @if (isDateTab()) {
      <!-- Pay Period / Date Range Picker -->
      <div class="period-bar">
        <div class="period-main">
          <button type="button" class="period-step" title="Previous pay period" (click)="stepPeriod(-1)">‹</button>
          <div class="period-label-wrap">
            <span class="period-kicker">{{ presetLabel() }}</span>
            <span class="period-label">{{ rangeLabel() }}</span>
          </div>
          <button type="button" class="period-step" title="Next pay period" (click)="stepPeriod(1)">›</button>
        </div>

        <div class="period-presets">
          <button type="button" class="preset-btn" [class.active]="rangePreset() === 'this-period'" (click)="applyPreset('this-period')">This pay period</button>
          <button type="button" class="preset-btn" [class.active]="rangePreset() === 'last-period'" (click)="applyPreset('last-period')">Last pay period</button>
          <button type="button" class="preset-btn" [class.active]="rangePreset() === 'this-month'" (click)="applyPreset('this-month')">This month</button>
          <button type="button" class="preset-btn" [class.active]="rangePreset() === 'last-month'" (click)="applyPreset('last-month')">Last month</button>
          <button type="button" class="preset-btn" [class.active]="rangePreset() === 'all'" (click)="applyPreset('all')">All time</button>
        </div>

        <div class="period-custom">
          <label class="date-field">
            <span>From</span>
            <input type="date" [ngModel]="rangeFromInput()" (ngModelChange)="onCustomFrom($event)" />
          </label>
          <label class="date-field">
            <span>To</span>
            <input type="date" [ngModel]="rangeToInput()" (ngModelChange)="onCustomTo($event)" />
          </label>
        </div>
      </div>

      <!-- KPI Summary Cards (for the selected dates) -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-icon"><app-icon name="clock" [size]="20" /></div>
          <div class="metric-info">
            <span class="metric-label">Hours Tracked</span>
            <span class="metric-value">{{ (totalTrackedSeconds() / 3600).toFixed(2) }} hrs</span>
            <span class="metric-sub">{{ rangeEntries().length }} entries · {{ totalTrackedSeconds() | formatDuration }}</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon"><app-icon name="wallet" [size]="20" /></div>
          <div class="metric-info">
            <span class="metric-label">Team Pay (you pay)</span>
            <span class="metric-value">{{ totalPayrollExpense() | money }}</span>
            <span class="metric-sub">Hours × each person's pay rate</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon"><app-icon name="building" [size]="20" /></div>
          <div class="metric-info">
            <span class="metric-label">Client Billing (you receive)</span>
            <span class="metric-value">{{ totalBilled() | money }}</span>
            <span class="metric-sub">Hours × each client's bill rate</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon"><app-icon name="trending" [size]="20" /></div>
          <div class="metric-info">
            <span class="metric-label">Your Margin</span>
            <span class="metric-value" [class.neg]="totalProfit() < 0">{{ totalProfit() | money }}</span>
            <span class="metric-sub">{{ totalMargin().toFixed(1) }}% of billing</span>
          </div>
        </div>
      </div>

      }

      <!-- TAB: VIEW & EDIT TIMESHEET -->
      @if (activeTab() === 'timesheets') {
        <div class="content-panel">
          <div class="panel-header">
            <div class="filters-wrap">
              <select class="filter-select" [ngModel]="selectedFilterEmployee()" (ngModelChange)="selectedFilterEmployee.set($event)">
                <option value="ALL">All Team Members</option>
                @for (emp of employees(); track emp.id) {
                  <option [value]="emp.id">{{ emp.name }}</option>
                }
              </select>
              <select class="filter-select" [ngModel]="selectedFilterClient()" (ngModelChange)="selectedFilterClient.set($event)">
                <option value="ALL">All Projects</option>
                @for (cli of clients(); track cli.id) {
                  <option [value]="cli.id">{{ cli.name }}</option>
                }
              </select>
              <input
                type="text"
                class="search-input"
                placeholder="Search tasks..."
                [ngModel]="searchQuery()"
                (ngModelChange)="searchQuery.set($event)"
              />
            </div>
            <div class="panel-actions">
              <div class="col-picker">
                <button type="button" class="action-btn" (click)="showColumnPicker.set(!showColumnPicker())">
                  <app-icon name="sidebar" [size]="15" /> Columns
                </button>
                @if (showColumnPicker()) {
                  <div class="col-picker-menu" (click)="$event.stopPropagation()">
                    @for (col of columnDefs; track col.key) {
                      <label class="col-picker-item">
                        <input type="checkbox" [checked]="tsColumns()[col.key]" (change)="toggleColumn(col.key)" [disabled]="col.locked" />
                        {{ col.label }}
                      </label>
                    }
                  </div>
                }
              </div>
              <button type="button" class="action-btn" (click)="exportRecordsCSV()"><app-icon name="download" [size]="15" /> Export CSV</button>
              <button type="button" class="btn-primary" (click)="openAddTimeModal()"><app-icon name="plus" [size]="15" /> Add time</button>
            </div>
          </div>

          <div class="ts-summary">
            <span class="ts-total">{{ filteredSeconds() | formatDuration }}</span>
            <span class="chip">Pay amount <strong>{{ filteredPay() | money }}</strong></span>
            <span class="chip">Bill amount <strong>{{ filteredBilled() | money }}</strong></span>
            <span class="chip">Manually added <strong>{{ manualPercent() | number:'1.0-0' }}%</strong></span>
            <span class="chip">{{ filteredEntries().length }} entries</span>
          </div>

          <div class="table-wrap" (click)="showColumnPicker.set(false)">
            <table class="data-table ts-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  @if (tsColumns().member) { <th>Member</th> }
                  @if (tsColumns().project) { <th>Project</th> }
                  @if (tsColumns().task) { <th>Task</th> }
                  @if (tsColumns().description) { <th>Activity description</th> }
                  @if (tsColumns().manual) { <th>Manually added</th> }
                  @if (tsColumns().pay) { <th>Pay</th> }
                  @if (tsColumns().bill) { <th>Bill</th> }
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (day of timesheetDays(); track day.key) {
                  @if (day.entries.length === 0) {
                    <tr class="empty-day">
                      <td class="day-cell">{{ day.label }}</td>
                      <td>0:00</td>
                      <td [attr.colspan]="visibleColumnCount()" class="text-muted">No time</td>
                    </tr>
                  }
                  @for (entry of day.entries; track entry.id; let first = $first) {
                    <tr [class.day-start]="first">
                      <td class="day-cell">
                        @if (first) {
                          {{ day.label }}
                          <div class="time-sub">{{ day.seconds | formatDuration }}</div>
                        }
                      </td>
                      <td class="time-range">
                        <span class="duration-num">{{ entry.durationSeconds | formatDuration }}</span>
                        @if (isManual(entry)) {
                          <span class="manual-tag" title="Added by hand, not by the timer">Manual</span>
                        }
                        <div class="time-sub">{{ formatTime(entry.startTime) }} – {{ entry.endTime ? formatTime(entry.endTime) : 'now' }}</div>
                      </td>
                      @if (tsColumns().member) { <td class="font-bold">{{ entry.employeeName }}</td> }
                      @if (tsColumns().project) { <td><span class="client-badge">{{ entry.clientName }}</span></td> }
                      @if (tsColumns().task) { <td class="task-cell-main" [title]="entry.taskDescription">{{ entry.taskDescription }}</td> }
                      @if (tsColumns().description) { <td class="task-cell-main text-muted" [title]="entry.taskDescription">{{ entry.taskDescription }}</td> }
                      @if (tsColumns().manual) { <td>{{ isManual(entry) ? '100%' : '0%' }}</td> }
                      @if (tsColumns().pay) {
                        <td class="pay-num">
                          {{ entry.totalPay | money }}
                          <div class="time-sub">{{ entry.hourlyRate | money:true }}</div>
                        </td>
                      }
                      @if (tsColumns().bill) {
                        <td class="bill-num">
                          {{ entryBilled(entry) | money }}
                          <div class="time-sub">{{ entryBillRate(entry) | money:true }}</div>
                        </td>
                      }
                      <td>
                        <div class="row-actions">
                          @if (entry.status === 'completed') {
                            <button type="button" class="btn-sm" title="Edit time" (click)="openEditTimeModal(entry)">Edit</button>
                          } @else {
                            <span class="live-tag">{{ entry.status === 'active' ? 'Working' : 'On break' }}</span>
                          }
                          @if (entry.screenshotCount > 0) {
                            <button type="button" class="btn-sm btn-icon" title="View screenshots" (click)="viewEntryScreenshots(entry.id)"><app-icon name="camera" [size]="14" /> {{ entry.screenshotCount }}</button>
                          }
                          <button type="button" class="del-btn" title="Delete" (click)="deleteEntry(entry.id)"><app-icon name="x" [size]="15" /></button>
                        </div>
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td [attr.colspan]="visibleColumnCount() + 1" class="empty-cell">No time for these dates and filters.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TAB: TIMESHEET APPROVAL -->
      @if (activeTab() === 'approvals') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Timesheet Approval · {{ rangeLabel() }}</h3>
              <p class="panel-sub">Team members submit their timesheet for the pay period. Approve it before you pay.</p>
            </div>
          </div>
          @if (!canMarkPaid()) {
            <div class="setup-banner">Pick a pay period (or From and To dates) above to review timesheets.</div>
          } @else {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Hours</th>
                    <th>Manual</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of payRows(); track row.employeeId) {
                    <tr>
                      <td class="font-bold">{{ row.employeeName }}</td>
                      <td class="duration-num">{{ row.totalHours | number:'1.2-2' }}</td>
                      <td class="text-muted">{{ memberManualPercent(row.employeeId) | number:'1.0-0' }}%</td>
                      <td class="pay-num">{{ row.totalPay | money }}</td>
                      <td>
                        <span class="ts-status" [attr.data-status]="approvalStatus(row.employeeId)">{{ approvalLabel(row.employeeId) }}</span>
                        @if (approvalFor(row.employeeId)?.note) {
                          <div class="time-sub">Note: {{ approvalFor(row.employeeId)?.note }}</div>
                        }
                        @if (approvalChanged(row.employeeId, row.totalHours)) {
                          <div class="time-sub warn-text">Hours changed since submitted</div>
                        }
                      </td>
                      <td class="text-muted">{{ approvalFor(row.employeeId) ? formatDateTimeShort(approvalFor(row.employeeId)!.submittedAt) : '—' }}</td>
                      <td>
                        <div class="row-actions">
                          <button type="button" class="btn-sm" (click)="reviewTimesheet(row.employeeId)">View</button>
                          @if (row.totalHours > 0 && approvalStatus(row.employeeId) !== 'approved') {
                            <button type="button" class="btn-sm btn-pay" (click)="setApproval(row, 'approved')">Approve</button>
                          }
                          @if (approvalStatus(row.employeeId) === 'submitted' || approvalStatus(row.employeeId) === 'approved') {
                            <button type="button" class="btn-sm text-red" (click)="setApproval(row, 'rejected')">Send back</button>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }

      <!-- TAB: REAL TIME (who is working now) -->
      @if (activeTab() === 'realtime') {
        <div class="metrics-grid rt-grid">
          <div class="metric-card">
            <div class="metric-info">
              <span class="metric-label">Team members</span>
              <span class="metric-value">{{ realTimeRows().length }}</span>
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-info">
              <span class="metric-label">Working now</span>
              <span class="metric-value rt-working">{{ workingNowCount() }}</span>
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-info">
              <span class="metric-label">On break</span>
              <span class="metric-value rt-break">{{ onBreakCount() }}</span>
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-info">
              <span class="metric-label">Not working</span>
              <span class="metric-value">{{ realTimeRows().length - workingNowCount() - onBreakCount() }}</span>
            </div>
          </div>
        </div>

        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Real-Time Team Status</h3>
              <p class="panel-sub">Refreshes every 30 seconds · last checked {{ formatTime(lastRefresh()) }}</p>
            </div>
            <button type="button" class="action-btn" (click)="refreshAllData()">↻ Refresh</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Status</th>
                  <th>Project</th>
                  <th>Task</th>
                  <th>Started</th>
                  <th>Today</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                @for (row of realTimeRows(); track row.employee.id) {
                  <tr>
                    <td>
                      <div class="emp-row-info">
                        <div class="avatar-sm" [style.background]="row.employee.avatarColor || '#a87c2c'">{{ row.employee.name.charAt(0) }}</div>
                        <span class="font-bold">{{ row.employee.name }}</span>
                      </div>
                    </td>
                    <td>
                      <span class="rt-pill" [class.on]="row.status === 'working'" [class.break]="row.status === 'break'">
                        {{ row.status === 'working' ? 'Working' : row.status === 'break' ? 'On break' : row.todaySeconds > 0 ? 'Offline' : 'Absent' }}
                      </span>
                    </td>
                    <td>{{ row.entry?.clientName || '—' }}</td>
                    <td class="task-cell-main">{{ row.entry?.taskDescription || '—' }}</td>
                    <td>{{ row.entry ? formatTime(row.entry.startTime) : '—' }}</td>
                    <td class="duration-num">{{ row.todaySeconds | formatDuration }}</td>
                    <td class="text-muted">{{ row.lastSeen ? formatDateTimeShort(row.lastSeen) : 'No time yet' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="earnings-note">
            Status comes from each person's timer. It updates as soon as they start, pause or stop their timer.
          </p>
        </div>
      }

      <!-- TAB: TRACKED HOURS REPORT -->
      @if (activeTab() === 'tracked') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Tracked Hours · {{ rangeLabel() }}</h3>
              <p class="panel-sub">By member and project, {{ trackedColumns().byMonth ? 'per month' : 'per day' }}</p>
            </div>
            <div class="panel-actions">
              <div class="seg">
                <button type="button" [class.active]="trackedMode() === 'hours'" (click)="trackedMode.set('hours')">Hours</button>
                <button type="button" [class.active]="trackedMode() === 'pay'" (click)="trackedMode.set('pay')">Pay</button>
                <button type="button" [class.active]="trackedMode() === 'bill'" (click)="trackedMode.set('bill')">Bill</button>
              </div>
              <button type="button" class="action-btn" (click)="exportTrackedCSV()">Export CSV</button>
            </div>
          </div>

          <div class="table-wrap">
            <table class="data-table tracked-table">
              <thead>
                <tr>
                  <th class="sticky-col">Member</th>
                  <th>Project</th>
                  @for (col of trackedColumns().cols; track col.key) {
                    <th class="num-col">{{ col.label }}</th>
                  }
                  <th class="num-col">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (row of trackedRows(); track row.key) {
                  <tr>
                    <td class="sticky-col font-bold">{{ row.employeeName }}</td>
                    <td><span class="client-badge">{{ row.clientName }}</span></td>
                    @for (col of trackedColumns().cols; track col.key) {
                      <td class="num-col" [class.zero]="!row.cells[col.key]">{{ trackedCell(row.cells[col.key]) }}</td>
                    }
                    <td class="num-col font-bold">{{ trackedCell(row.total) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td [attr.colspan]="trackedColumns().cols.length + 3" class="empty-cell">No time in this date range.</td>
                  </tr>
                }
              </tbody>
              @if (trackedRows().length > 0) {
                <tfoot>
                  <tr class="tfoot-row">
                    <td class="sticky-col"><strong>Total</strong></td>
                    <td></td>
                    @for (col of trackedColumns().cols; track col.key) {
                      <td class="num-col"><strong>{{ trackedCell(trackedColumnTotal(col.key)) }}</strong></td>
                    }
                    <td class="num-col"><strong>{{ trackedCell(trackedGrandTotal()) }}</strong></td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
        </div>
      }

      <!-- TAB: CLIENT EARNINGS (what you receive vs. what you pay) -->
      @if (activeTab() === 'earnings') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Client Earnings · {{ rangeLabel() }}</h3>
              <p class="panel-sub">
                What each client pays you (hours × client bill rate) vs. what you pay the team (hours × team pay rate)
              </p>
            </div>
            <button type="button" class="action-btn" (click)="exportEarningsCSV()">Download Earnings CSV</button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Avg Bill Rate</th>
                  <th>Hours</th>
                  <th>You Receive</th>
                  <th>You Pay Team</th>
                  <th>Your Margin</th>
                  <th>Margin %</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (c of clientEarnings(); track c.clientId) {
                  <tr>
                    <td>
                      <div class="client-row-info">
                        <span class="color-dot" [style.background]="c.color"></span>
                        <button type="button" class="link-btn font-bold" (click)="openProjectDetail(c.clientId)">{{ c.clientName }}</button>
                      </div>
                    </td>
                    <td>
                      @if (c.billRate > 0) {
                        <span class="rate-num">{{ c.billRate | money }}/hr</span>
                      } @else {
                        <span class="rate-missing">Not set</span>
                      }
                    </td>
                    <td class="duration-num">{{ c.totalHours | number:'1.2-2' }}</td>
                    <td class="bill-num">{{ c.billed | money }}</td>
                    <td class="cost-num">{{ c.teamCost | money }}</td>
                    <td class="pay-num" [class.neg]="c.profit < 0">{{ c.profit | money }}</td>
                    <td>
                      <div class="margin-cell">
                        <div class="margin-bar">
                          <span [style.width.%]="c.margin > 0 ? c.margin : 0" [class.neg]="c.profit < 0"></span>
                        </div>
                        <span [class.neg]="c.profit < 0">{{ c.billed > 0 ? (c.margin | number:'1.0-1') + '%' : '—' }}</span>
                      </div>
                    </td>
                    <td><button type="button" class="btn-sm btn-icon" (click)="editClientRates(c.clientId)"><app-icon name="edit" [size]="13" /> Edit rates</button></td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="empty-cell">No client hours in this date range.</td>
                  </tr>
                }
              </tbody>
              @if (clientEarnings().length > 0) {
                <tfoot>
                  <tr class="tfoot-row">
                    <td><strong>TOTALS</strong></td>
                    <td>-</td>
                    <td class="duration-num"><strong>{{ totalTrackedSeconds() / 3600 | number:'1.2-2' }}</strong></td>
                    <td class="bill-num"><strong>{{ totalBilled() | money }}</strong></td>
                    <td class="cost-num"><strong>{{ totalPayrollExpense() | money }}</strong></td>
                    <td class="pay-num" [class.neg]="totalProfit() < 0"><strong>{{ totalProfit() | money }}</strong></td>
                    <td><strong>{{ totalMargin() | number:'1.0-1' }}%</strong></td>
                    <td></td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>

          <div class="section-title" style="margin-top: 2rem;">By Team Member &amp; Client</div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Team Member</th>
                  <th>Client</th>
                  <th>Hours</th>
                  <th>Pay Rate</th>
                  <th>Bill Rate</th>
                  <th>You Receive</th>
                  <th>You Pay</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                @for (row of memberClientEarnings(); track row.key) {
                  <tr>
                    <td class="font-bold">{{ row.employeeName }}</td>
                    <td><span class="client-badge">{{ row.clientName }}</span></td>
                    <td class="duration-num">{{ row.totalHours | number:'1.2-2' }}</td>
                    <td class="rate-num">{{ row.payRate | money }}/hr</td>
                    <td class="rate-num">{{ row.billRate > 0 ? (row.billRate | money:true) : 'Not set' }}</td>
                    <td class="bill-num">{{ row.billed | money }}</td>
                    <td class="cost-num">{{ row.teamCost | money }}</td>
                    <td class="pay-num" [class.neg]="row.profit < 0">{{ row.profit | money }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="empty-cell">No team hours in this date range.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <p class="earnings-note">
            Bill rates come from <strong>Contracts</strong> (member × project), or the project's default bill rate when there's no contract.
            Pay uses the rate saved on each time entry when it was tracked.
          </p>
        </div>
      }

      <!-- TAB: PAYMENTS (history of what was paid) -->
      @if (activeTab() === 'payments') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Payments</h3>
              <p class="panel-sub">Every "Mark as paid" record, newest first · Total paid {{ totalPaidAllTime() | money }}</p>
            </div>
            <button type="button" class="action-btn" (click)="exportPaymentsCSV()"><app-icon name="download" [size]="15" /> Export CSV</button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Paid On</th>
                  <th>Member</th>
                  <th>Pay Period</th>
                  <th>Hours</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (p of payoutHistory(); track p.id) {
                  <tr>
                    <td><input type="date" class="inline-input" [ngModel]="toDateInputMs(p.paidAt)" (change)="updatePayout(p, 'paidAt', $any($event.target).value)" /></td>
                    <td class="font-bold">{{ p.employeeName }}</td>
                    <td>{{ formatDate(p.periodStart) }} – {{ formatDate(p.periodEnd) }}</td>
                    <td class="duration-num">{{ p.hours | number:'1.2-2' }}</td>
                    <td><span class="inline-money">{{ currencySymbol }}<input type="number" class="inline-input num" min="0" step="0.01" [ngModel]="p.amount" (change)="updatePayout(p, 'amount', $any($event.target).value)" /></span></td>
                    <td><input class="inline-input" [ngModel]="p.note || ''" (change)="updatePayout(p, 'note', $any($event.target).value)" placeholder="e.g. GCash ref" /></td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn-sm btn-icon" (click)="openPayslip(p)"><app-icon name="receipt" [size]="13" /> Payslip</button>
                        <button type="button" class="del-btn" title="Delete payment record" (click)="undoPayout(p.id)"><app-icon name="x" [size]="15" /></button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="empty-cell">No payments recorded yet. Go to Team Pay and use "Mark as paid" after you pay someone.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TAB: TEAM PAY (payroll per pay period) -->
      @if (activeTab() === 'payroll') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Team Pay · {{ rangeLabel() }}</h3>
              <p class="panel-sub">How much to pay each person for these dates, and whether it's been paid</p>
            </div>
            <button type="button" class="action-btn" (click)="exportPayrollReportCSV()">Download Pay CSV</button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Projects</th>
                  <th>Hours</th>
                  <th>Avg Rate</th>
                  <th>Amount to Pay</th>
                  <th>Timesheet</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (row of payRows(); track row.employeeId) {
                  <tr>
                    <td class="font-bold">{{ row.employeeName }}</td>
                    <td class="text-muted">{{ row.projects.join(', ') || '—' }}</td>
                    <td class="duration-num">{{ row.totalHours | number:'1.2-2' }}</td>
                    <td class="rate-num">{{ row.avgRate | money:true }}</td>
                    <td class="pay-num">{{ row.totalPay | money }}</td>
                    <td>
                      <span class="ts-status" [attr.data-status]="approvalStatus(row.employeeId)">{{ approvalLabel(row.employeeId) }}</span>
                    </td>
                    <td>
                      @if (row.payout) {
                        <span class="paid-pill" [title]="'Paid ' + formatDateTimeShort(row.payout.paidAt)">
                          Paid {{ row.payout.amount | money }}
                        </span>
                        @if (row.payout.amount.toFixed(2) !== row.totalPay.toFixed(2)) {
                          <div class="time-sub warn-text">Hours changed since paid</div>
                        }
                      } @else if (row.totalPay > 0) {
                        <span class="unpaid-pill">Unpaid</span>
                      } @else {
                        <span class="text-muted">—</span>
                      }
                    </td>
                    <td>
                      @if (row.payout) {
                        <button type="button" class="btn-sm btn-icon" (click)="openPayslip(row.payout)"><app-icon name="receipt" [size]="13" /> Payslip</button>
                        <button type="button" class="btn-sm" (click)="undoPayout(row.payout.id)">Undo</button>
                      } @else if (row.totalPay > 0) {
                        <button type="button" class="btn-sm btn-pay" [disabled]="!canMarkPaid()" (click)="markPaid(row)"
                          [title]="canMarkPaid() ? 'Record this payment' : 'Pick a pay period or dates with a start and end first'">
                          Mark as paid
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="empty-cell">No team members yet.</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr class="tfoot-row">
                  <td><strong>TOTAL</strong></td>
                  <td></td>
                  <td class="duration-num"><strong>{{ totalTrackedSeconds() / 3600 | number:'1.2-2' }}</strong></td>
                  <td></td>
                  <td class="pay-num"><strong>{{ totalPayrollExpense() | money }}</strong></td>
                  <td></td>
                  <td colspan="2"><strong>Paid {{ totalPaidInRange() | money }}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

        </div>
      }

      <!-- TAB 2: EMPLOYEE MANAGEMENT -->
      @if (activeTab() === 'people') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Team Members</h3>
              <p class="panel-sub">Profiles, roles, sign-in PINs and default pay rates (contracts can override per project)</p>
            </div>
            <button type="button" class="btn-primary" (click)="openAddEmployeeModal()">
              <app-icon name="plus" [size]="15" /> Add Member
            </button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Default Pay Rate</th>
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
                        <div class="avatar-sm" [style.background]="emp.avatarColor || '#a87c2c'">
                          {{ emp.name.charAt(0) }}
                        </div>
                        <div>
                          <input class="inline-input strong" [ngModel]="emp.name" (change)="updateEmployee(emp, 'name', $any($event.target).value)" title="Click to edit name" />
                          <input class="inline-input small" type="email" [ngModel]="emp.email" (change)="updateEmployee(emp, 'email', $any($event.target).value)" title="Click to edit email" placeholder="email" />
                        </div>
                      </div>
                    </td>
                    <td>
                      <select class="inline-input select" [ngModel]="emp.role" (ngModelChange)="updateEmployee(emp, 'role', $event)">
                        <option value="user">Team member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td><input class="inline-input" [ngModel]="emp.department || ''" (change)="updateEmployee(emp, 'department', $any($event.target).value)" placeholder="Team" /></td>
                    <td>
                      <div class="rate-editor">
                        <span class="inline-money">{{ currencySymbol }}<input type="number" class="inline-input num" min="0" step="0.01" [ngModel]="emp.hourlyRate" (change)="updateEmployee(emp, 'hourlyRate', $any($event.target).value)" /><span class="per">/hr</span></span>
                      </div>
                    </td>
                    <td>
                      <span class="pin-badge"><app-icon name="key" [size]="13" /> {{ emp.pin ? '••••' : 'Not set' }}</span>
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

      <!-- TAB: PROJECTS and TAB: CONTRACTS -->
      @if (activeTab() === 'projects' || activeTab() === 'contracts') {
        @if (!cloudTablesReady()) {
          <div class="setup-banner">
            <app-icon name="alert" [size]="16" /> <strong>One-time setup needed:</strong> the database doesn't have the Contracts, Payments and Timesheet Approval tables yet, so
            they can't be saved. Run <code>supabase_schema.sql</code> in Supabase → SQL Editor.
          </div>
        }

        @if (activeTab() === 'projects') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Projects</h3>
              <p class="panel-sub">Each project is a client. The default bill rate is used when a member has no contract.</p>
            </div>
            <button type="button" class="btn-primary" (click)="openAddClientModal()"><app-icon name="plus" [size]="15" /> Add Project</button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Code</th>
                  <th>Members</th>
                  <th>Hours Spent (all time)</th>
                  <th>Default Bill Rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (cli of clients(); track cli.id) {
                  <tr>
                    <td>
                      <div class="client-row-info">
                        <span class="color-dot" [style.background]="cli.color || '#a87c2c'"></span>
                        <input class="inline-input strong" [ngModel]="cli.name" (change)="updateClient(cli, 'name', $any($event.target).value)" title="Click to edit" />
                      </div>
                    </td>
                    <td><input class="inline-input code" [ngModel]="cli.code" (change)="updateClient(cli, 'code', $any($event.target).value)" maxlength="6" /></td>
                    <td>{{ projectMemberCount(cli.id) }}</td>
                    <td class="duration-num">{{ projectHours(cli.id) | number:'1.2-2' }}</td>
                    <td><span class="inline-money">{{ currencySymbol }}<input type="number" class="inline-input num" min="0" step="0.01" [ngModel]="cli.defaultRate || 0" (change)="updateClient(cli, 'defaultRate', $any($event.target).value)" /><span class="per">/hr</span></span></td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn-sm btn-view" (click)="openProjectDetail(cli.id)">Team &amp; rates</button>
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

        @if (activeTab() === 'contracts') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Contracts · Rates per Member per Project</h3>
              <p class="panel-sub">Like WebWork Contracts: what you pay each person and what you bill the client, per project</p>
            </div>
            <div class="panel-actions">
              <select class="filter-select" [ngModel]="contractFilterClient()" (ngModelChange)="contractFilterClient.set($event)">
                <option value="ALL">All Projects</option>
                @for (cli of clients(); track cli.id) {
                  <option [value]="cli.id">{{ cli.name }}</option>
                }
              </select>
              <button type="button" class="btn-primary" (click)="openAddContractModal()"><app-icon name="plus" [size]="15" /> Add Contract</button>
            </div>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Project</th>
                  <th>Pay Rate</th>
                  <th>Bill Rate</th>
                  <th>Margin / hr</th>
                  <th>This Week</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (c of filteredContracts(); track c.id) {
                  <tr>
                    <td class="font-bold">{{ employeeName(c.employeeId) }}</td>
                    <td><span class="client-badge">{{ clientName(c.clientId) }}</span></td>
                    <td><span class="inline-money">{{ currencySymbol }}<input type="number" class="inline-input num" min="0" step="0.01" [ngModel]="c.payRate" (change)="updateContract(c, 'payRate', $any($event.target).value)" /><span class="per">/hr</span></span></td>
                    <td><span class="inline-money">{{ currencySymbol }}<input type="number" class="inline-input num" min="0" step="0.01" [ngModel]="c.billRate" (change)="updateContract(c, 'billRate', $any($event.target).value)" /><span class="per">/hr</span></span></td>
                    <td class="pay-num" [class.neg]="c.billRate - c.payRate < 0">{{ c.billRate - c.payRate | money }}</td>
                    <td>
                      <span class="duration-num">{{ contractWeekHours(c) | number:'1.1-1' }}h</span>
                      <span class="text-muted"> / </span>
                      <input type="number" class="inline-input tiny" min="0" [ngModel]="c.weeklyLimitHours ?? ''" (change)="updateContract(c, 'weeklyLimitHours', $any($event.target).value)" placeholder="none" title="Weekly limit (hours)" />
                      @if (c.weeklyLimitHours) {
                        @if (contractWeekHours(c) > c.weeklyLimitHours) {
                          <span class="over-tag">Over limit</span>
                        }
                      }
                    </td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn-sm" (click)="openEditContractModal(c)">Edit</button>
                        <button type="button" class="btn-sm text-red" (click)="deleteContract(c.id)">Delete</button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="empty-cell">No contracts yet. Add one to set a pay and bill rate for a member on a project.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        }
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
                  <span class="gallery-zoom-icon"><app-icon name="search" [size]="14" /></span>
                </div>
                <div class="gallery-card-body">
                  <div class="gallery-card-header">
                    <span class="gallery-emp">{{ ss.employeeName }}</span>
                    <span class="gallery-time">{{ formatTime(ss.timestamp) }}</span>
                  </div>
                  <div class="gallery-date">{{ formatDate(ss.timestamp) }}</div>
                </div>
              </div>
            } @empty {
              <div class="empty-gallery">
                <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--av-text-faint)" stroke-width="1.5" fill="none">
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

      <!-- TAB: IMPORT & EXPORT -->
      @if (activeTab() === 'importExport') {
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-heading">Import &amp; Export</h3>
              <p class="panel-sub">Get your data out as CSV or a full backup, or bring time entries in from a CSV file.</p>
            </div>
          </div>

          <div class="ie-grid">
            <div class="ie-card">
              <h4 class="ie-card-title">Export CSV</h4>
              <p class="ie-card-sub">Uses the pay period / dates picked on each page.</p>
              <div class="ie-btn-list">
                <button type="button" class="btn-sm ie-btn" (click)="exportRecordsCSV()"><app-icon name="download" [size]="14" /> Timesheet records</button>
                <button type="button" class="btn-sm ie-btn" (click)="exportPayrollReportCSV()"><app-icon name="download" [size]="14" /> Team pay</button>
                <button type="button" class="btn-sm ie-btn" (click)="exportEarningsCSV()"><app-icon name="download" [size]="14" /> Client earnings</button>
                <button type="button" class="btn-sm ie-btn" (click)="exportPaymentsCSV()"><app-icon name="download" [size]="14" /> Payment history</button>
                <button type="button" class="btn-sm ie-btn" (click)="exportTrackedCSV()"><app-icon name="download" [size]="14" /> Tracked hours</button>
              </div>
            </div>

            <div class="ie-card">
              <h4 class="ie-card-title">Import time entries (CSV)</h4>
              <p class="ie-card-sub">Columns: Employee ID, Client ID, Date (YYYY-MM-DD), Start (HH:MM), End (HH:MM), Task.</p>
              <div class="ie-btn-list">
                <button type="button" class="btn-sm ie-btn" (click)="downloadTimeImportTemplate()"><app-icon name="download" [size]="14" /> Download template</button>
                <label class="btn-sm ie-btn btn-upload">
                  <app-icon name="upload" [size]="14" /> Choose CSV to import
                  <input type="file" accept=".csv" (change)="importTimeCSV($event)" style="display: none;" />
                </label>
              </div>
              @if (csvImportBusy()) {
                <p class="text-xs text-muted">Importing…</p>
              }
              @if (csvImportResult()) {
                <div class="test-feedback" [class.success]="!csvImportResult()!.errors.length" [class.error]="csvImportResult()!.errors.length > 0">
                  Added {{ csvImportResult()!.added }} of {{ csvImportResult()!.total }} rows.
                  @if (csvImportResult()!.errors.length) {
                    <ul class="ie-error-list">
                      @for (err of csvImportResult()!.errors; track $index) {
                        <li>{{ err }}</li>
                      }
                    </ul>
                  }
                </div>
              }
            </div>

            <div class="ie-card">
              <h4 class="ie-card-title">Full backup (JSON)</h4>
              <p class="ie-card-sub">Everything: people, projects, contracts, time, screenshots, payments and settings.</p>
              <div class="ie-btn-list">
                <button type="button" class="btn-sm ie-btn" (click)="exportBackup()"><app-icon name="download" [size]="14" /> Export JSON backup</button>
                <label class="btn-sm ie-btn btn-upload">
                  <app-icon name="upload" [size]="14" /> Import JSON backup
                  <input type="file" accept=".json" (change)="importBackup($event)" style="display: none;" />
                </label>
              </div>
              <p class="text-xs text-muted">Importing a backup adds/updates records by id — it does not delete anything already here.</p>
            </div>
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

          <!-- Team Access -->
          <div class="access-box">
            <div class="access-head">
              <div>
                <h4 class="section-title" style="margin: 0;">Team Access</h4>
                <p class="panel-sub">Choose what team members can see and do. Admins always have full access.
                  "Everyone" is the default; change a person's row to give them their own setting.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="data-table access-table">
                <thead>
                  <tr>
                    <th>Who</th>
                    @for (p of permissionLabels; track p.key) {
                      <th class="center" [title]="p.hint">{{ p.label }}<div class="th-hint">{{ p.hint }}</div></th>
                    }
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="everyone-row">
                    <td class="font-bold">Everyone <span class="text-muted text-xs">(default)</span></td>
                    @for (p of permissionLabels; track p.key) {
                      <td class="center">
                        <label class="toggle-switch sm">
                          <input type="checkbox" [checked]="defaultPermissions()[p.key]" (change)="setPermission('default', p.key, $any($event.target).checked)" />
                          <span class="toggle-slider"></span>
                        </label>
                      </td>
                    }
                    <td></td>
                  </tr>
                  @for (emp of teamMembers(); track emp.id) {
                    <tr>
                      <td>
                        <span class="font-bold">{{ emp.name }}</span>
                        <div class="text-xs text-muted">{{ hasOwnPermissions(emp.id) ? 'Own setting' : 'Uses Everyone' }}</div>
                      </td>
                      @for (p of permissionLabels; track p.key) {
                        <td class="center">
                          <label class="toggle-switch sm">
                            <input type="checkbox" [checked]="memberPermissions(emp)[p.key]" (change)="setPermission(emp.id, p.key, $any($event.target).checked)" />
                            <span class="toggle-slider"></span>
                          </label>
                        </td>
                      }
                      <td>
                        @if (hasOwnPermissions(emp.id)) {
                          <button type="button" class="btn-sm" (click)="resetPermissions(emp.id)">Use Everyone</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
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
                  <div class="test-feedback success">Admin PIN updated.</div>
                }
              </div>
            </div>

            <!-- Supabase Info Card -->
            <div class="script-guide-box">
              <div class="guide-header">
                <div>
                  <h4 class="guide-title">Cloud database (Supabase)</h4>
                  <p class="guide-sub">All data is saved straight to the Supabase database. The app needs an internet connection to save changes.</p>
                </div>
              </div>
              <ul class="steps-list">
                <li>Employees, clients, time entries and screenshots are stored in <strong>Supabase tables</strong>.</li>
                <li>Manage your data in your <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">Supabase Dashboard</a>.</li>
              </ul>
            </div>

            <!-- Backup & Restore -->
            <div class="backup-section">
              <h4 class="section-title">Database Backup &amp; Restore</h4>
              <p class="text-xs text-muted">Export a full JSON snapshot of all tracker data or import from a previous backup.</p>
              <div class="backup-btn-row">
                <button type="button" class="btn-sm" (click)="exportBackup()"><app-icon name="download" [size]="14" /> Export JSON Backup</button>
                <label class="btn-sm btn-upload">
                  <app-icon name="upload" [size]="14" /> Import JSON Backup
                  <input type="file" accept=".json" (change)="importBackup($event)" style="display: none;" />
                </label>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
    </div>

    @if (savedNote()) {
      <div class="saved-toast"><app-icon name="check" [size]="15" /> {{ savedNote() }}</div>
    }

    <!-- PAYSLIP -->
    @if (payslipFor()) {
      <app-payslip
        [payout]="payslipFor()!"
        [entries]="entries()"
        [email]="employeeEmail(payslipFor()!.employeeId)"
        (closed)="payslipFor.set(null)"
      />
    }

    <!-- PROJECT DETAIL: team and rates on one project -->
    @if (projectDetailId()) {
      <div class="modal-overlay" (click)="projectDetailId.set(null)">
        <div class="modal-content project-modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <span class="eyebrow-gold">Project</span>
              <h3>{{ clientName(projectDetailId()!) }}</h3>
              <p class="modal-meta">
                Default bill rate {{ projectDefaultRate(projectDetailId()!) | money:true }} ·
                {{ projectMemberCount(projectDetailId()!) }} team members ·
                {{ periodLabel(currentPeriodRange()) }}
              </p>
            </div>
            <button class="modal-close" (click)="projectDetailId.set(null)"><app-icon name="x" [size]="18" /></button>
          </div>
          <div class="modal-body project-body">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Pay rate</th>
                  <th>Bill rate</th>
                  <th>Margin / hr</th>
                  <th>Hours (this period)</th>
                  <th>Pay</th>
                  <th>Billed</th>
                </tr>
              </thead>
              <tbody>
                @for (row of projectTeam(projectDetailId()!); track row.employeeId) {
                  <tr>
                    <td class="font-bold">
                      {{ row.name }}
                      @if (!row.contract) { <div class="time-sub">No contract, uses default rates</div> }
                    </td>
                    <td class="cost-num">{{ row.payRate | money:true }}</td>
                    <td class="bill-num">{{ row.billRate | money:true }}</td>
                    <td class="pay-num" [class.neg]="row.billRate - row.payRate < 0">{{ row.billRate - row.payRate | money }}</td>
                    <td class="duration-num">{{ row.hours | number:'1.2-2' }}</td>
                    <td class="cost-num">{{ row.pay | money }}</td>
                    <td class="bill-num">{{ row.billed | money }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty-cell">Nobody is on this project yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button type="button" class="action-btn" (click)="editClientRates(projectDetailId()!); projectDetailId.set(null)">Edit rates</button>
            <button type="button" class="btn-primary" (click)="addMemberToProject(projectDetailId()!)"><app-icon name="plus" [size]="15" /> Add team member</button>
          </div>
        </div>
      </div>
    }

    <!-- ADD/EDIT EMPLOYEE MODAL -->
    @if (showEmployeeModal()) {
      <div class="modal-overlay" (click)="showEmployeeModal.set(false)">
        <div class="modal-content-sm" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>{{ editingEmployee() ? 'Edit Employee' : 'Add New Employee' }}</h3>
            <button class="modal-close" (click)="showEmployeeModal.set(false)"><app-icon name="x" [size]="18" /></button>
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
              <label class="form-label">Default Pay Rate ({{ currencySymbol }} / hour)</label>
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
              <label class="form-label">Starting PIN</label>
              <input
                type="text"
                class="form-input"
                [(ngModel)]="employeeForm.pin"
                placeholder="Leave blank for firstname+23, e.g. kyeth23"
                maxlength="10"
              />
              <p class="text-xs text-muted">
                They'll be asked to choose their own PIN the first time they sign in with this one.
              </p>
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
            <h3>{{ editingClient() ? 'Edit Project' : 'Add New Project' }}</h3>
            <button class="modal-close" (click)="showClientModal.set(false)"><app-icon name="x" [size]="18" /></button>
          </div>
          <div class="modal-body-form">
            <div class="form-group">
              <label class="form-label">Project / Client Name</label>
              <input type="text" class="form-input" [(ngModel)]="clientForm.name" placeholder="e.g. Acme Corporation" />
            </div>
            <div class="form-group">
              <label class="form-label">Project Code (2-4 uppercase chars)</label>
              <input type="text" class="form-input" [(ngModel)]="clientForm.code" placeholder="e.g. ACM" />
            </div>
            <div class="form-group">
              <label class="form-label">Default Bill Rate ({{ currencySymbol }}/hr)</label>
              <input type="number" class="form-input" [(ngModel)]="clientForm.defaultRate" min="0" />
            </div>
            <div class="form-group">
              <label class="form-label">Color Code</label>
              <input type="color" class="form-input-color" [(ngModel)]="clientForm.color" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-cancel" (click)="showClientModal.set(false)">Cancel</button>
            <button type="button" class="btn-save" (click)="saveClientForm()">Save Project</button>
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
            <button class="modal-close" (click)="selectedScreenshot.set(null)"><app-icon name="x" [size]="18" /></button>
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

    <!-- ADD / EDIT TIME MODAL -->
    @if (showTimeModal()) {
      <div class="modal-overlay" (click)="showTimeModal.set(false)">
        <div class="modal-content-sm" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>{{ editingEntry() ? 'Edit Time' : 'Add Time' }}</h3>
            <button class="modal-close" (click)="showTimeModal.set(false)"><app-icon name="x" [size]="18" /></button>
          </div>
          <div class="modal-body-form">
            <div class="form-group">
              <label class="form-label">Member</label>
              <select class="form-select" [(ngModel)]="timeForm.employeeId">
                @for (emp of employees(); track emp.id) {
                  <option [value]="emp.id">{{ emp.name }}</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Project</label>
              <select class="form-select" [(ngModel)]="timeForm.clientId">
                @for (cli of clients(); track cli.id) {
                  <option [value]="cli.id">{{ cli.name }}</option>
                }
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Date</label>
                <input type="date" class="form-input" [(ngModel)]="timeForm.date" />
              </div>
              <div class="form-group">
                <label class="form-label">Start</label>
                <input type="time" class="form-input" [(ngModel)]="timeForm.start" />
              </div>
              <div class="form-group">
                <label class="form-label">End</label>
                <input type="time" class="form-input" [(ngModel)]="timeForm.end" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Task</label>
              <input type="text" class="form-input" [(ngModel)]="timeForm.task" placeholder="What was worked on" />
            </div>
            <p class="text-xs text-muted">
              Pay rate used: <strong>{{ timeFormPayRate() | money:true }}</strong> · Bill rate:
              <strong>{{ timeFormBillRate() | money:true }}</strong>
            </p>
            @if (timeFormError()) {
              <div class="test-feedback error">{{ timeFormError() }}</div>
            }
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-cancel" (click)="showTimeModal.set(false)">Cancel</button>
            <button type="button" class="btn-save" (click)="saveTimeForm()">Save Time</button>
          </div>
        </div>
      </div>
    }

    <!-- ADD / EDIT CONTRACT MODAL -->
    @if (showContractModal()) {
      <div class="modal-overlay" (click)="showContractModal.set(false)">
        <div class="modal-content-sm" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>{{ editingContract() ? 'Edit Contract' : 'Add Contract' }}</h3>
            <button class="modal-close" (click)="showContractModal.set(false)"><app-icon name="x" [size]="18" /></button>
          </div>
          <div class="modal-body-form">
            <div class="form-group">
              <label class="form-label">Member</label>
              <select class="form-select" [(ngModel)]="contractForm.employeeId">
                @for (emp of employees(); track emp.id) {
                  <option [value]="emp.id">{{ emp.name }}</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Project</label>
              <select class="form-select" [(ngModel)]="contractForm.clientId">
                @for (cli of clients(); track cli.id) {
                  <option [value]="cli.id">{{ cli.name }}</option>
                }
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Pay rate ({{ currencySymbol }}/hr)</label>
                <input type="number" class="form-input" [(ngModel)]="contractForm.payRate" min="0" step="0.01" />
              </div>
              <div class="form-group">
                <label class="form-label">Bill rate ({{ currencySymbol }}/hr)</label>
                <input type="number" class="form-input" [(ngModel)]="contractForm.billRate" min="0" step="0.01" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Weekly limit (hours, optional)</label>
              <input type="number" class="form-input" [(ngModel)]="contractForm.weeklyLimitHours" min="0" />
            </div>
            <p class="text-xs text-muted">New timers on this project use this pay rate. Past entries keep the rate they had.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-cancel" (click)="showContractModal.set(false)">Cancel</button>
            <button type="button" class="btn-save" (click)="saveContractForm()">Save Contract</button>
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
      color: var(--av-text);
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
      color: var(--av-text-muted);
      margin: 4px 0 0 0;
    }
    .admin-tabs {
      display: flex;
      gap: 6px;
      background: var(--av-surface);
      padding: 4px;
      border-radius: 12px;
      border: 1px solid var(--av-border);
      flex-wrap: wrap;
    }
    .tab-btn {
      padding: 8px 14px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--av-text-muted);
      background: transparent;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      color: var(--av-text);
    }
    .tab-btn.active {
      background: var(--av-gold);
      color: white;
      box-shadow: 0 2px 8px rgba(168, 124, 44, 0.4);
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1rem;
    }
    .metric-card {
      background: var(--av-surface);
      border: 1px solid var(--av-border);
      border-radius: 14px;
      padding: 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      box-shadow: 0 4px 12px rgba(6, 60, 53, 0.07);
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
    .metric-icon.blue { background: rgba(168, 124, 44, 0.15); }
    .metric-icon.green { background: rgba(16, 185, 129, 0.15); }
    .metric-icon.purple { background: rgba(168, 124, 44, 0.15); }
    .metric-icon.orange { background: rgba(245, 158, 11, 0.15); }
    .metric-info {
      display: flex;
      flex-direction: column;
    }
    .metric-label {
      font-size: 0.78rem;
      color: var(--av-text-muted);
      font-weight: 500;
    }
    .metric-value {
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--av-text);
      letter-spacing: -0.02em;
      margin: 2px 0;
    }
    .metric-sub {
      font-size: 0.72rem;
      color: var(--av-text-faint);
    }
    .content-panel {
      background: var(--av-surface);
      border: 1px solid var(--av-border);
      border-radius: 16px;
      padding: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(6, 60, 53, 0.1);
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
      color: var(--av-text-muted);
      margin: 3px 0 0 0;
    }
    .filters-wrap {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .search-input, .filter-select {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--av-text);
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
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      color: var(--av-text);
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .action-btn:hover {
      background: var(--av-border);
    }
    .btn-primary {
      background: var(--av-forest);
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
      background: var(--av-forest-hover);
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
      color: var(--av-text-muted);
      border-bottom: 1px solid var(--av-border);
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .data-table td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--av-divider);
      color: var(--av-text-body);
    }
    .data-table tr:hover td {
      background: rgba(168, 124, 44, 0.05);
    }
    .date-cell {
      font-weight: 600;
      color: var(--av-text);
    }
    .time-sub {
      font-size: 0.75rem;
      color: var(--av-text-muted);
    }
    .emp-badge {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .emp-name {
      font-weight: 600;
      color: var(--av-text);
    }
    .client-badge {
      background: var(--av-surface-2);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--av-gold-text);
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
      color: var(--av-text-muted);
      margin-left: 4px;
    }
    .rate-num {
      font-weight: 600;
      color: var(--av-text-body);
    }
    .pay-num {
      font-weight: 700;
      color: var(--av-green);
    }
    .ss-count-btn {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      color: var(--av-text-muted);
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .ss-count-btn:hover:not(:disabled) {
      color: var(--av-gold-text);
      border-color: var(--av-gold-text);
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
      color: var(--av-green-text);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .tag-pending {
      background: rgba(245, 158, 11, 0.15);
      color: var(--av-amber-text);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .del-btn {
      background: none;
      border: none;
      color: var(--av-text-faint);
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
      color: var(--av-text-faint);
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
      background: var(--av-surface-2);
      color: var(--av-text-muted);
    }
    .role-pill.admin {
      background: rgba(168, 124, 44, 0.15);
      color: var(--av-gold-text);
      border: 1px solid rgba(168, 124, 44, 0.3);
    }
    .rate-large {
      font-size: 1rem;
      font-weight: 700;
      color: var(--av-green);
    }
    .badge-active {
      background: rgba(16, 185, 129, 0.15);
      color: var(--av-green-text);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .pin-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      padding: 3px 8px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.8rem;
      color: var(--av-gold-text);
      letter-spacing: 0.05em;
    }
    .row-actions {
      display: flex;
      gap: 8px;
    }
    .btn-sm {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      color: var(--av-text-body);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .btn-sm:hover {
      background: var(--av-border);
      color: white;
    }
    .text-red {
      color: var(--av-red-text);
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
      background: var(--av-surface-2);
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 0.78rem;
      color: var(--av-gold-text);
    }
    .section-title {
      font-size: 1.05rem;
      font-weight: 700;
      margin: 1.25rem 0 0.75rem 0;
      color: var(--av-text);
    }
    .tfoot-row td {
      border-top: 2px solid var(--av-border);
      font-size: 0.95rem;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1.25rem;
    }
    .gallery-card {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .gallery-card:hover {
      transform: translateY(-2px);
      border-color: var(--av-gold-text);
    }
    .gallery-img-wrap {
      position: relative;
      height: 140px;
      background: var(--av-linen);
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
      background: rgba(6, 60, 53, 0.7);
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
      color: var(--av-text);
    }
    .gallery-time {
      font-size: 0.75rem;
      color: var(--av-text-muted);
    }
    .gallery-date {
      font-size: 0.75rem;
      color: var(--av-text-faint);
    }
    .drive-link {
      display: inline-block;
      margin-top: 6px;
      font-size: 0.72rem;
      color: var(--av-gold-text);
      text-decoration: none;
    }
    .drive-link:hover {
      text-decoration: underline;
    }
    .empty-gallery {
      grid-column: 1 / -1;
      text-align: center;
      padding: 4rem 1rem;
      color: var(--av-text-faint);
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
      border-bottom: 1px solid var(--av-border);
    }
    @media (max-width: 768px) {
      .setting-item {
        grid-template-columns: 1fr;
      }
    }
    .setting-title {
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--av-text);
    }
    .setting-desc {
      font-size: 0.82rem;
      color: var(--av-text-muted);
      margin: 4px 0 0 0;
    }
    .form-select-lg, .form-input-lg {
      width: 100%;
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--av-text);
      font-size: 0.9rem;
      outline: none;
    }
    .input-with-button {
      display: flex;
      gap: 8px;
    }
    .btn-test {
      background: var(--av-border);
      color: white;
      border: 1px solid var(--av-border-strong);
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-test:hover:not(:disabled) {
      background: var(--av-border-strong);
    }
    .test-feedback {
      margin-top: 8px;
      font-size: 0.8rem;
      padding: 8px 12px;
      border-radius: 6px;
    }
    .test-feedback.success {
      background: rgba(16,185,129,0.15);
      color: var(--av-green-text);
      border: 1px solid rgba(16,185,129,0.3);
    }
    .test-feedback.error {
      background: rgba(239,68,68,0.15);
      color: var(--av-red-text);
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
      background-color: var(--av-border);
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
      background-color: var(--av-green);
    }
    input:checked + .toggle-slider:before {
      transform: translateX(22px);
    }
    .script-guide-box {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
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
      color: var(--av-text);
    }
    .guide-sub {
      font-size: 0.8rem;
      color: var(--av-text-muted);
      margin: 2px 0 0 0;
    }
    .btn-copy-code {
      background: var(--av-forest);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-copy-code:hover {
      background: var(--av-forest-hover);
    }
    .steps-list {
      margin: 0;
      padding-left: 1.25rem;
      font-size: 0.85rem;
      color: var(--av-text-body);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .steps-list a {
      color: var(--av-gold-text);
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
    .ie-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.25rem;
    }
    .ie-card {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 14px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ie-card-title {
      font-size: 1rem;
      font-weight: 700;
      color: var(--av-forest);
      margin: 0;
    }
    .ie-card-sub {
      font-size: 0.8rem;
      color: var(--av-text-muted);
      margin: 0;
    }
    .ie-btn-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }
    .ie-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-start;
      width: 100%;
    }
    .ie-error-list {
      margin: 6px 0 0;
      padding-left: 1.2rem;
      font-size: 0.78rem;
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(6, 40, 35, 0.55);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: 1.5rem;
    }
    .modal-content-sm {
      background: var(--av-surface);
      border-radius: 14px;
      border: 1px solid var(--av-border-strong);
      max-width: 480px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(6, 60, 53, 0.18);
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
      color: var(--av-text-body);
    }
    .form-input, .form-select {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--av-text);
      font-size: 0.88rem;
      outline: none;
    }
    .form-input-color {
      height: 40px;
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
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
      border-top: 1px solid var(--av-border);
      background: var(--av-surface);
    }
    .btn-cancel {
      background: var(--av-border);
      color: var(--av-text-body);
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .btn-save {
      background: var(--av-forest);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .modal-content {
      background: var(--av-surface);
      border-radius: 16px;
      border: 1px solid var(--av-border-strong);
      max-width: 900px;
      width: 100%;
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--av-border);
    }
    .modal-header h3 {
      margin: 0;
      font-size: 1.1rem;
      color: var(--av-text);
    }
    .modal-meta {
      margin: 4px 0 0 0;
      font-size: 0.8rem;
      color: var(--av-text-muted);
    }
    .modal-close {
      background: none;
      border: none;
      color: var(--av-text-body);
      font-size: 1.25rem;
      cursor: pointer;
    }
    .modal-body {
      padding: 1rem;
      max-height: 65vh;
      overflow: auto;
      text-align: center;
      background: var(--av-surface-2);
    }
    .modal-body img {
      max-width: 100%;
      max-height: 60vh;
      border-radius: 8px;
      border: 1px solid var(--av-border);
    }
    .download-btn {
      background: var(--av-forest);
      color: white;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    /* Pay period picker */
    .period-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.85rem 1.25rem;
      background: var(--av-surface);
      border: 1px solid var(--av-border);
      border-radius: 14px;
      padding: 0.85rem 1.1rem;
      box-shadow: 0 4px 12px rgba(6, 60, 53, 0.05);
    }
    .period-main {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .period-step {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 1px solid var(--av-border);
      background: var(--av-surface-2);
      color: var(--av-forest);
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
    }
    .period-step:hover {
      border-color: var(--av-gold);
      color: var(--av-gold-text);
    }
    .period-label-wrap {
      display: flex;
      flex-direction: column;
      min-width: 190px;
    }
    .period-kicker {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--av-gold-text);
      font-weight: 600;
    }
    .period-label {
      font-family: var(--av-font-heading);
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--av-forest);
    }
    .period-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .preset-btn {
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--av-border);
      background: var(--av-surface-2);
      color: var(--av-text-body);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
    }
    .preset-btn:hover {
      border-color: var(--av-gold);
    }
    .preset-btn.active {
      background: var(--av-forest);
      border-color: var(--av-forest);
      color: var(--av-ivory);
    }
    .period-custom {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .date-field {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: var(--av-text-muted);
      font-weight: 500;
    }
    .date-field input {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 8px;
      padding: 6px 8px;
      color: var(--av-forest);
      font-size: 0.82rem;
    }
    .metric-value.neg, .pay-num.neg, span.neg {
      color: var(--av-red-text);
    }
    .bill-num {
      font-weight: 700;
      color: var(--av-forest);
    }
    .cost-num {
      font-weight: 600;
      color: var(--av-gold-text);
    }
    .rate-missing {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--av-amber-text);
      background: rgba(245, 158, 11, 0.12);
      padding: 3px 8px;
      border-radius: 6px;
    }
    .margin-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 130px;
    }
    .margin-bar {
      flex: 1;
      height: 6px;
      background: var(--av-divider);
      border-radius: 999px;
      overflow: hidden;
    }
    .margin-bar span {
      display: block;
      height: 100%;
      background: var(--av-green);
      border-radius: 999px;
    }
    .earnings-note {
      margin-top: 1rem;
      font-size: 0.78rem;
      color: var(--av-text-muted);
    }
    .admin-title {
      font-family: var(--av-font-heading);
    }
    @media (max-width: 640px) {
      .admin-page {
        padding: 0 1rem;
      }
      .search-input {
        min-width: 0;
        width: 100%;
      }
      .period-label-wrap {
        min-width: 0;
      }
      .metrics-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.6rem;
      }
      .metric-card {
        padding: 0.85rem;
        gap: 0.6rem;
      }
      .metric-icon {
        display: none;
      }
      .metric-value {
        font-size: 1.1rem;
      }
    }
    .font-bold { font-weight: 600; color: var(--av-text); }
    .text-muted { color: var(--av-text-muted); }
    .text-xs { font-size: 0.78rem; }
    .panel-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    /* Timesheet */
    .ts-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 1rem; }
    .ts-total { font-family: var(--av-font-heading); font-size: 1.9rem; font-weight: 700; color: var(--av-forest); margin-right: 6px; }
    .chip { font-size: 0.8rem; color: var(--av-text-muted); background: var(--av-surface-2); border: 1px solid var(--av-border); padding: 5px 10px; border-radius: 999px; }
    .chip strong { color: var(--av-forest); margin-left: 4px; }
    .ts-table td { vertical-align: top; padding: 10px 10px; }
    .ts-table .task-cell-main { max-width: 200px; }
    .ts-table tr.day-start td { border-top: 1px solid var(--av-border); }
    .day-cell { font-weight: 600; color: var(--av-forest); white-space: nowrap; }
    .time-range { white-space: nowrap; }
    .empty-day td { color: var(--av-text-faint); background: var(--av-bg-deep); }
    .live-tag { font-size: 0.72rem; font-weight: 600; color: var(--av-green-text); background: rgba(46, 125, 91, 0.12); padding: 3px 8px; border-radius: 6px; }
    /* Real time */
    .rt-working { color: var(--av-green); }
    .rt-break { color: var(--av-amber-text); }
    .rt-pill { display: inline-block; min-width: 76px; text-align: center; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; background: var(--av-divider); color: var(--av-text-muted); }
    .rt-pill.on { background: var(--av-green); color: #fff; }
    .rt-pill.break { background: rgba(245, 158, 11, 0.18); color: var(--av-amber-text); }
    /* Tracked hours */
    .seg { display: inline-flex; border: 1px solid var(--av-border); border-radius: 8px; overflow: hidden; }
    .seg button { background: var(--av-surface-2); border: none; padding: 7px 14px; font-size: 0.82rem; color: var(--av-text-body); cursor: pointer; }
    .seg button + button { border-left: 1px solid var(--av-border); }
    .seg button.active { background: var(--av-forest); color: var(--av-ivory); }
    .tracked-table th, .tracked-table td { white-space: nowrap; }
    .num-col { text-align: right; font-variant-numeric: tabular-nums; }
    .num-col.zero { color: var(--av-text-faint); }
    .sticky-col { position: sticky; left: 0; background: var(--av-surface); z-index: 1; }
    /* Pay */
    .paid-pill { font-size: 0.75rem; font-weight: 600; color: #fff; background: var(--av-green); padding: 4px 10px; border-radius: 999px; }
    .unpaid-pill { font-size: 0.75rem; font-weight: 600; color: var(--av-amber-text); background: rgba(245, 158, 11, 0.15); padding: 4px 10px; border-radius: 999px; }
    .btn-pay { border-color: var(--av-forest); color: var(--av-forest); font-weight: 600; }
    .btn-pay:disabled { opacity: 0.45; cursor: not-allowed; }
    .warn-text { color: var(--av-amber-text); }
    /* Projects */
    .setup-banner { background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); color: var(--av-amber-text); border-radius: 12px; padding: 0.85rem 1rem; font-size: 0.85rem; }
    .setup-banner code { background: var(--av-surface); padding: 1px 6px; border-radius: 4px; }
    .over-tag { margin-left: 6px; font-size: 0.7rem; font-weight: 600; color: var(--av-red-text); background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 6px; }
    .form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
    /* Side menu layout */
    .admin-shell {
      max-width: 1400px;
      margin: 1.25rem auto;
      padding: 0 1.25rem;
      display: grid;
      grid-template-columns: 230px minmax(0, 1fr);
      gap: 1.5rem;
      align-items: start;
    }
    .admin-shell .admin-page {
      max-width: none;
      margin: 0;
      padding: 0;
      min-width: 0;
    }
    .side-menu {
      position: sticky;
      top: 1rem;
      background: var(--av-forest);
      border-radius: 16px;
      padding: 0.9rem 0.6rem;
      color: var(--av-ivory);
    }
    .menu-toggle { display: none; }
    .menu-group + .menu-group { margin-top: 0.9rem; }
    .menu-title {
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--av-gold-soft);
      padding: 0 0.7rem 0.35rem;
      font-weight: 600;
    }
    .menu-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      color: rgba(254, 250, 241, 0.82);
      font-size: 0.86rem;
      padding: 8px 10px;
      border-radius: 10px;
      cursor: pointer;
      text-align: left;
    }
    .menu-item:hover { background: rgba(254, 250, 241, 0.08); color: var(--av-ivory); }
    .menu-item.active { background: var(--av-gold); color: #fff; font-weight: 600; }
    .menu-icon { width: 20px; text-align: center; }
    .menu-badge {
      margin-left: auto;
      background: var(--av-green);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
    }
    @media (max-width: 900px) {
      .admin-shell { grid-template-columns: 1fr; padding: 0 1rem; }
      .side-menu { position: relative; top: 0; padding: 0.5rem; }
      .menu-toggle {
        display: flex;
        width: 100%;
        justify-content: space-between;
        align-items: center;
        background: none;
        border: none;
        color: var(--av-ivory);
        font-size: 0.95rem;
        font-weight: 600;
        padding: 8px 10px;
        cursor: pointer;
      }
      .menu-groups { display: none; padding-top: 0.5rem; }
      .side-menu.open .menu-groups { display: block; }
    }
    /* ── Premium layer ─────────────────────────────────────────────── */
    .admin-shell { margin-top: 2rem; }
    .side-menu {
      background: linear-gradient(180deg, var(--av-forest), var(--av-forest-deep));
      border-radius: 20px;
      padding: 1.1rem 0.7rem;
      box-shadow: 0 24px 48px -28px rgba(6, 60, 53, 0.7);
    }
    .menu-title { font-size: 0.62rem; letter-spacing: 0.18em; opacity: 0.9; }
    .menu-item { font-size: 0.85rem; padding: 9px 12px; }
    .menu-item.active {
      background: rgba(254, 250, 241, 0.1);
      color: var(--av-ivory);
      box-shadow: inset 2px 0 0 var(--av-gold);
      font-weight: 600;
    }
    .menu-item.active .menu-icon { color: var(--av-gold-soft); }
    .menu-toggle-label { display: inline-flex; align-items: center; gap: 8px; }
    .chev { transition: transform 0.2s ease; }
    .chev.up { transform: rotate(180deg); }
    .admin-header { padding-bottom: 0.25rem; }
    .admin-title {
      font-size: 1.85rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--av-forest);
    }
    .admin-subtitle {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--av-gold-text);
      font-weight: 600;
      margin-top: 6px;
    }
    .content-panel, .metric-card, .period-bar {
      border-radius: 20px;
      border: 1px solid var(--av-border);
      box-shadow: 0 1px 2px rgba(6, 60, 53, 0.04), 0 18px 40px -26px rgba(6, 60, 53, 0.22);
    }
    .content-panel { padding: 1.75rem; }
    .panel-heading { font-family: var(--av-font-heading); font-weight: 600; letter-spacing: -0.01em; color: var(--av-forest); }
    .metric-card { padding: 1.35rem; }
    .metric-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--av-surface-2);
      color: var(--av-gold-text);
      box-shadow: inset 0 0 0 1px var(--av-gold-soft);
    }
    .metric-label {
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 600;
    }
    .metric-value {
      font-family: var(--av-font-heading);
      font-weight: 600;
      font-size: 1.55rem;
      font-variant-numeric: tabular-nums;
      color: var(--av-forest);
    }
    .data-table th {
      font-size: 0.66rem;
      letter-spacing: 0.12em;
      color: var(--av-text-muted);
      background: var(--av-surface-2);
      border-bottom: 1px solid var(--av-border);
    }
    .data-table th:first-child { border-top-left-radius: 10px; }
    .data-table th:last-child { border-top-right-radius: 10px; }
    .data-table td { font-variant-numeric: tabular-nums; }
    .data-table tr:hover td { background: rgba(168, 124, 44, 0.04); }
    .btn-primary, .btn-save {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 9px 18px;
      background: var(--av-forest);
      box-shadow: 0 10px 20px -14px rgba(6, 60, 53, 0.8);
    }
    .btn-primary:hover, .btn-save:hover { background: var(--av-forest-hover); }
    .action-btn {
      border-radius: 999px;
      background: var(--av-surface);
      border-color: var(--av-border-strong);
      color: var(--av-forest);
    }
    .action-btn:hover { background: var(--av-surface-2); border-color: var(--av-gold); }
    .btn-sm { border-radius: 999px; padding: 4px 12px; background: var(--av-surface); }
    .btn-icon { display: inline-flex; align-items: center; gap: 4px; }
    .del-btn { display: inline-flex; align-items: center; }
    .search-input, .filter-select, .form-input, .form-select, .form-select-lg, .form-input-lg {
      border-radius: 10px;
      background: var(--av-surface);
      border-color: var(--av-border-strong);
    }
    .search-input:focus, .filter-select:focus, .form-input:focus, .form-select:focus {
      border-color: var(--av-gold);
      box-shadow: 0 0 0 3px rgba(168, 124, 44, 0.15);
    }
    .client-badge {
      background: rgba(168, 124, 44, 0.1);
      color: var(--av-gold-text);
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 0.72rem;
      letter-spacing: 0.02em;
    }
    .pin-badge { display: inline-flex; align-items: center; gap: 6px; }
    .col-picker { position: relative; display: inline-block; }
    .col-picker-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 40;
      background: var(--av-surface);
      border: 1px solid var(--av-border-strong);
      border-radius: 10px;
      box-shadow: 0 12px 28px -10px rgba(6, 60, 53, 0.35);
      padding: 8px;
      min-width: 200px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .col-picker-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 0.85rem;
      color: var(--av-text);
      cursor: pointer;
    }
    .col-picker-item:hover { background: var(--av-surface-2); }
    .col-picker-item input { accent-color: var(--av-forest); }
    .manual-tag {
      margin-left: 6px;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: var(--av-gold-text);
      border: 1px solid var(--av-gold-soft);
      padding: 1px 6px;
      border-radius: 999px;
    }
    .ts-status {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--av-divider);
      color: var(--av-text-muted);
      white-space: nowrap;
    }
    .ts-status[data-status='approved'] { background: rgba(46, 125, 91, 0.12); color: var(--av-green-text); }
    .ts-status[data-status='submitted'] { background: rgba(168, 124, 44, 0.14); color: var(--av-gold-text); }
    .ts-status[data-status='rejected'] { background: rgba(239, 68, 68, 0.1); color: var(--av-red-text); }
    .preset-btn.active, .seg button.active { background: var(--av-forest); }
    .setup-banner { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
    .modal-content-sm, .modal-content { border-radius: 20px; border-color: var(--av-border); }
    .modal-close { display: inline-flex; color: var(--av-text-muted); }
    .gallery-zoom-icon { color: var(--av-ivory); }
    /* Collapsible side menu */
    .collapse-btn {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: 1px solid rgba(254, 250, 241, 0.14);
      color: rgba(254, 250, 241, 0.75);
      border-radius: 10px;
      padding: 7px 10px;
      margin-bottom: 0.9rem;
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .collapse-btn:hover { color: var(--av-ivory); border-color: var(--av-gold-soft); }
    .admin-shell.collapsed { grid-template-columns: 68px minmax(0, 1fr); }
    .admin-shell.collapsed .side-menu { padding: 0.9rem 0.5rem; }
    .admin-shell.collapsed .menu-title,
    .admin-shell.collapsed .menu-item span:not(.menu-badge),
    .admin-shell.collapsed .collapse-label { display: none; }
    .admin-shell.collapsed .menu-item { justify-content: center; padding: 10px 0; position: relative; }
    .admin-shell.collapsed .menu-badge { position: absolute; top: 2px; right: 2px; padding: 0 5px; font-size: 0.6rem; }
    .admin-shell.collapsed .collapse-btn { justify-content: center; padding: 7px 0; }
    .admin-shell.collapsed .menu-group + .menu-group { margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(254, 250, 241, 0.1); }
    .menu-badge.live { background: var(--av-gold); }
    @media (max-width: 900px) {
      .collapse-btn { display: none; }
      .admin-shell.collapsed { grid-template-columns: 1fr; }
    }

    /* Home */
    .home-grid { display: flex; flex-direction: column; gap: 1.25rem; }
    .payday-card {
      background: linear-gradient(135deg, var(--av-forest), var(--av-forest-deep));
      color: var(--av-ivory);
      border-radius: 22px;
      padding: 1.75rem;
      position: relative;
      overflow: hidden;
      box-shadow: 0 24px 50px -28px rgba(6, 60, 53, 0.8);
    }
    .payday-card::after {
      content: '';
      position: absolute;
      right: -60px;
      top: -60px;
      width: 220px;
      height: 220px;
      border-radius: 50%;
      border: 1px solid rgba(217, 184, 119, 0.25);
    }
    .payday-top { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    .eyebrow-gold {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--av-gold-soft);
      font-weight: 600;
    }
    .modal-header .eyebrow-gold { color: var(--av-gold-text); }
    .payday-countdown {
      font-size: 0.78rem;
      font-weight: 600;
      background: rgba(254, 250, 241, 0.12);
      padding: 4px 12px;
      border-radius: 999px;
    }
    .payday-card.soon .payday-countdown { background: var(--av-gold); color: #fff; }
    .payday-date { font-family: var(--av-font-heading); font-size: 2rem; font-weight: 600; margin-top: 0.75rem; letter-spacing: -0.01em; }
    .payday-sub { font-size: 0.82rem; opacity: 0.75; margin-top: 2px; }
    .payday-amount {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      margin-top: 1.25rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(254, 250, 241, 0.14);
      font-size: 0.85rem;
      opacity: 0.95;
    }
    .payday-amount strong { font-family: var(--av-font-heading); font-size: 1.6rem; color: var(--av-gold-soft); }
    .payday-steps { display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.82rem; margin-top: 0.5rem; opacity: 0.85; }
    .payday-actions { display: flex; gap: 10px; margin-top: 1.25rem; flex-wrap: wrap; position: relative; z-index: 1; }
    .payday-actions .btn-primary { background: var(--av-gold); }
    .payday-actions .btn-primary:hover { background: #b98a33; }
    .payday-actions .action-btn { background: transparent; color: var(--av-ivory); border-color: rgba(254, 250, 241, 0.35); }
    .alert-card {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: var(--av-amber-text);
      border-radius: 16px;
      padding: 0.9rem 1.1rem;
      font-size: 0.86rem;
    }
    .alert-card > div { flex: 1; }
    .home-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
    .now-list { display: flex; flex-direction: column; }
    .now-row { display: flex; align-items: center; gap: 12px; padding: 0.7rem 0; border-bottom: 1px solid var(--av-divider); }
    .now-row:last-child { border-bottom: none; }
    .now-info { flex: 1; display: flex; flex-direction: column; font-size: 0.85rem; min-width: 0; }
    .now-info .text-muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Project detail */
    .link-btn { background: none; border: none; padding: 0; font: inherit; color: var(--av-forest); cursor: pointer; text-align: left; }
    .link-btn:hover { color: var(--av-gold-text); text-decoration: underline; }
    .btn-view { border-color: var(--av-gold-soft); color: var(--av-gold-text); font-weight: 600; }
    .project-modal { max-width: 960px; }
    .project-modal .modal-header { align-items: flex-start; }
    .project-body { text-align: left; background: var(--av-surface); max-height: 60vh; }

    /* Team Access */
    .access-box {
      border: 1px solid var(--av-border);
      border-radius: 16px;
      padding: 1.25rem;
      margin-bottom: 1.75rem;
      background: var(--av-surface-2);
    }
    .access-head { margin-bottom: 0.75rem; }
    .access-table th.center, .access-table td.center { text-align: center; }
    .th-hint { font-size: 0.6rem; text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--av-text-faint); margin-top: 2px; }
    .everyone-row td { background: rgba(168, 124, 44, 0.06); }
    .toggle-switch.sm { width: 38px; height: 22px; }
    .toggle-switch.sm .toggle-slider:before { width: 14px; height: 14px; }
    .toggle-switch.sm input:checked + .toggle-slider:before { transform: translateX(16px); }
    .toggle-switch input:checked + .toggle-slider { background-color: var(--av-forest); }
    /* Inline editing */
    .inline-input {
      font: inherit;
      color: var(--av-forest);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 4px 6px;
      width: 100%;
      min-width: 90px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .inline-input:hover { border-color: var(--av-border); background: var(--av-surface); }
    .inline-input:focus { outline: none; border-color: var(--av-gold); background: var(--av-surface); box-shadow: 0 0 0 3px rgba(168, 124, 44, 0.15); }
    .inline-input.strong { font-weight: 600; }
    .inline-input.small { font-size: 0.78rem; color: var(--av-text-muted); }
    .inline-input.code { width: 80px; min-width: 0; font-weight: 700; color: var(--av-gold-text); text-transform: uppercase; }
    .inline-input.num { width: 90px; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .inline-input.tiny { width: 76px; min-width: 0; }
    .inline-input.select { width: auto; cursor: pointer; }
    .inline-money { display: inline-flex; align-items: center; gap: 2px; color: var(--av-text-muted); white-space: nowrap; }
    .inline-money .per { font-size: 0.75rem; }
    .client-badge { white-space: nowrap; }
    .data-table td .font-bold { white-space: nowrap; }
    .saved-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--av-forest);
      color: var(--av-ivory);
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 0.85rem;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 14px 30px -14px rgba(6, 60, 53, 0.7);
      z-index: 3000;
    }
  `],
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  readonly currencySymbol = CURRENCY_SYMBOL;
  activeTab = signal<AdminTab>('overview');
  sidebarCollapsed = signal<boolean>(this.readCollapsed());
  projectDetailId = signal<string | null>(null);
  payslipFor = signal<Payout | null>(null);
  menuOpen = signal<boolean>(false);
  showColumnPicker = signal<boolean>(false);
  csvImportBusy = signal<boolean>(false);
  csvImportResult = signal<{ total: number; added: number; errors: string[] } | null>(null);

  /** Which columns show on View & Edit Timesheet, like WebWork's own "Columns" menu. */
  readonly columnDefs: { key: keyof TimesheetColumns; label: string; locked?: boolean }[] = [
    { key: 'member', label: 'Member' },
    { key: 'project', label: 'Project' },
    { key: 'task', label: 'Task' },
    { key: 'description', label: 'Activity description' },
    { key: 'manual', label: 'Manually added' },
    { key: 'pay', label: 'Pay amount' },
    { key: 'bill', label: 'Bill amount' },
  ];
  tsColumns = signal<TimesheetColumns>(this.readColumnPrefs());

  toggleColumn(key: keyof TimesheetColumns): void {
    const next = { ...this.tsColumns(), [key]: !this.tsColumns()[key] };
    this.tsColumns.set(next);
    try {
      localStorage.setItem('auravia_ts_columns', JSON.stringify(next));
    } catch {}
  }

  visibleColumnCount(): number {
    return 2 + Object.values(this.tsColumns()).filter(Boolean).length;
  }

  private readColumnPrefs(): TimesheetColumns {
    const defaults: TimesheetColumns = { member: true, project: true, task: true, description: false, manual: false, pay: true, bill: true };
    try {
      const saved = localStorage.getItem('auravia_ts_columns');
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  }

  readonly menuGroups: { title: string; items: { tab: AdminTab; label: string; icon: string }[] }[] = [
    {
      title: 'Home',
      items: [
        { tab: 'overview', label: 'Overview', icon: 'home' },
        { tab: 'tracker', label: 'My Timer', icon: 'play' },
      ],
    },
    {
      title: 'Timesheets',
      items: [
        { tab: 'timesheets', label: 'View & Edit Timesheet', icon: 'calendar' },
        { tab: 'approvals', label: 'Timesheet Approval', icon: 'check' },
      ],
    },
    {
      title: 'Analyze',
      items: [
        { tab: 'realtime', label: 'Real Time', icon: 'activity' },
        { tab: 'tracked', label: 'Tracked Hours', icon: 'chart' },
        { tab: 'gallery', label: 'Screenshots', icon: 'image' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { tab: 'payroll', label: 'Team Pay', icon: 'wallet' },
        { tab: 'payments', label: 'Payments', icon: 'receipt' },
        { tab: 'earnings', label: 'Client Earnings', icon: 'trending' },
      ],
    },
    {
      title: 'Manage',
      items: [
        { tab: 'people', label: 'People', icon: 'users' },
        { tab: 'projects', label: 'Projects', icon: 'folder' },
        { tab: 'contracts', label: 'Contracts', icon: 'contract' },
        { tab: 'importExport', label: 'Import & Export', icon: 'download' },
        { tab: 'settings', label: 'Settings', icon: 'settings' },
      ],
    },
  ];

  toggleSidebar(): void {
    this.sidebarCollapsed.set(!this.sidebarCollapsed());
    try {
      localStorage.setItem('auravia_sidebar_collapsed', this.sidebarCollapsed() ? '1' : '0');
    } catch {}
  }

  private readCollapsed(): boolean {
    try {
      return localStorage.getItem('auravia_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  }

  goTo(tab: AdminTab): void {
    this.activeTab.set(tab);
    this.menuOpen.set(false);
  }

  currentMenuLabel(): string {
    for (const g of this.menuGroups) {
      const item = g.items.find((i) => i.tab === this.activeTab());
      if (item) return item.label;
    }
    return 'Admin';
  }

  contracts = signal<Contract[]>([]);
  payouts = signal<Payout[]>([]);
  approvals = signal<TimesheetApproval[]>([]);
  savedNote = signal<string>('');
  permissionRows = signal<TeamPermissionRow[]>([]);
  readonly permissionLabels = PERMISSION_LABELS;
  cloudTablesReady = signal<boolean>(true);
  lastRefresh = signal<number>(Date.now());
  trackedMode = signal<TrackedMode>('hours');
  contractFilterClient = signal<string>('ALL');
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  // Add / edit time
  showTimeModal = signal<boolean>(false);
  editingEntry = signal<TimeEntry | null>(null);
  timeFormError = signal<string>('');
  timeForm = { employeeId: '', clientId: '', date: '', start: '09:00', end: '10:00', task: '' };

  // Add / edit contract
  showContractModal = signal<boolean>(false);
  editingContract = signal<Contract | null>(null);
  contractForm = { employeeId: '', clientId: '', payRate: 0, billRate: 0, weeklyLimitHours: null as number | null };

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

  // Selected dates (defaults to the current pay period; null = open-ended)
  rangePreset = signal<RangePreset>('this-period');
  rangeStart = signal<Date | null>(null);
  rangeEnd = signal<Date | null>(null);

  // Modals & Forms
  showEmployeeModal = signal<boolean>(false);
  editingEmployee = signal<Employee | null>(null);
  employeeForm = {
    name: '',
    email: '',
    hourlyRate: 0,
    role: 'user' as UserRole,
    department: '',
    pin: '1234',
  };

  showClientModal = signal<boolean>(false);
  editingClient = signal<Client | null>(null);
  clientForm = {
    name: '',
    code: '',
    defaultRate: 0,
    color: '#a87c2c',
  };

  newAdminPin = '';
  pinSaved = signal<boolean>(false);

  constructor(
    private db: DataService,
    public timerService: TimerService,
    public authService: AuthService,
    private nav: NavService
  ) {
    // The top bar can ask to open a page (e.g. clicking the running timer opens My Timer)
    effect(() => {
      const tab = this.nav.requestedTab();
      if (tab) {
        untracked(() => {
          this.goTo(tab as AdminTab);
          this.nav.requestedTab.set(null);
        });
      }
    });
  }

  private readonly money = new MoneyPipe();

  async ngOnInit(): Promise<void> {
    // Bring back my own running timer (so the top-bar timer shows on every page)
    const me = this.authService.currentUser();
    if (me && this.timerService.status() === 'completed') await this.timerService.restoreActiveSession(me.id);
    this.applyPreset('this-period');
    await this.refreshAllData();
    this.cloudTablesReady.set(await this.db.cloudTablesReady());
    // Keep "who's working" fresh
    this.refreshTimer = setInterval(() => this.refreshAllData(), 30000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  isDateTab(): boolean {
    return ['timesheets', 'approvals', 'tracked', 'earnings', 'payroll'].includes(this.activeTab());
  }

  async refreshAllData(): Promise<void> {
    const [emps, clis, ents, sss, sets, cons, pays] = await Promise.all([
      this.db.getEmployees(),
      this.db.getClients(),
      this.db.getTimeEntries(),
      this.db.getScreenshots(),
      this.db.getSettings(),
      this.db.getContracts(),
      this.db.getPayouts(),
    ]);

    this.approvals.set(await this.db.getApprovals());
    this.permissionRows.set(await this.db.getPermissions());
    this.contracts.set(cons);
    this.payouts.set(pays);
    this.lastRefresh.set(Date.now());

    this.employees.set(emps);
    this.clients.set(clis);
    this.entries.set(ents);
    this.screenshots.set(sss);
    this.settings.set(sets);
  }

  // --- Pay Period / Date Range ---
  // Pay periods are semi-monthly: 1st–15th and 16th–end of month.

  applyPreset(preset: Exclude<RangePreset, 'custom'>): void {
    const today = new Date();
    let start: Date | null = null;
    let end: Date | null = null;

    if (preset === 'this-period' || preset === 'last-period') {
      [start, end] = this.payPeriodFor(today);
      if (preset === 'last-period') {
        [start, end] = this.payPeriodFor(new Date(start.getTime() - DAY_MS));
      }
    } else if (preset === 'this-month') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (preset === 'last-month') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    }

    this.rangePreset.set(preset);
    this.rangeStart.set(start);
    this.rangeEnd.set(end);
  }

  /** Move one pay period back (-1) or forward (+1) from the current start date. */
  stepPeriod(direction: -1 | 1): void {
    const anchor = this.rangeStart() ?? new Date();
    let [start, end] = this.payPeriodFor(anchor);
    if (this.rangeStart() && anchor.getTime() === start.getTime()) {
      const jump = direction < 0 ? new Date(start.getTime() - DAY_MS) : new Date(end.getTime() + DAY_MS);
      [start, end] = this.payPeriodFor(jump);
    }
    const [current] = this.payPeriodFor(new Date());
    const last = this.payPeriodFor(new Date(current.getTime() - DAY_MS))[0];
    this.rangePreset.set(
      start.getTime() === current.getTime() ? 'this-period' : start.getTime() === last.getTime() ? 'last-period' : 'custom'
    );
    this.rangeStart.set(start);
    this.rangeEnd.set(end);
  }

  onCustomFrom(value: string): void {
    this.rangePreset.set('custom');
    this.rangeStart.set(this.parseDateInput(value));
  }

  onCustomTo(value: string): void {
    this.rangePreset.set('custom');
    this.rangeEnd.set(this.parseDateInput(value));
  }

  rangeFromInput(): string {
    return this.toDateInput(this.rangeStart());
  }

  rangeToInput(): string {
    return this.toDateInput(this.rangeEnd());
  }

  presetLabel(): string {
    const labels: Record<RangePreset, string> = {
      'this-period': 'This pay period',
      'last-period': 'Last pay period',
      'this-month': 'This month',
      'last-month': 'Last month',
      all: 'All time',
      custom: 'Custom dates',
    };
    return labels[this.rangePreset()];
  }

  rangeLabel(): string {
    const start = this.rangeStart();
    const end = this.rangeEnd();
    const fmt = (d: Date, withYear: boolean) =>
      d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
    if (!start && !end) return 'All dates';
    if (start && !end) return `From ${fmt(start, true)}`;
    if (!start && end) return `Up to ${fmt(end, true)}`;
    const sameYear = start!.getFullYear() === end!.getFullYear();
    return `${fmt(start!, !sameYear)} – ${fmt(end!, true)}`;
  }

  /** Entries whose start time falls inside the selected dates (end date is inclusive). */
  rangeEntries(): TimeEntry[] {
    const start = this.rangeStart()?.getTime() ?? -Infinity;
    const endDate = this.rangeEnd();
    const end = endDate ? endDate.getTime() + DAY_MS : Infinity;
    return this.entries().filter((e) => e.startTime >= start && e.startTime < end);
  }

  rangeScreenshotCount(): number {
    return this.rangeEntries().reduce((acc, e) => acc + (e.screenshotCount || 0), 0);
  }

  private payPeriodFor(date: Date): [Date, Date] {
    const y = date.getFullYear();
    const m = date.getMonth();
    return date.getDate() <= 15
      ? [new Date(y, m, 1), new Date(y, m, 15)]
      : [new Date(y, m, 16), new Date(y, m + 1, 0)];
  }

  private parseDateInput(value: string): Date | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  }

  private toDateInput(date: Date | null): string {
    if (!date) return '';
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${mm}-${dd}`;
  }

  // --- Computed Metrics (all follow the selected dates) ---

  totalTrackedSeconds(): number {
    return this.rangeEntries().reduce((acc, curr) => acc + curr.durationSeconds, 0);
  }

  totalPayrollExpense(): number {
    return this.rangeEntries().reduce((acc, curr) => acc + (curr.totalPay || 0), 0);
  }

  /** Bill rate for an entry: the member's contract on that project, else the project's default rate. */
  entryBillRate(entry: TimeEntry): number {
    return billRateFor(this.contracts(), this.clients(), entry.employeeId, entry.clientId);
  }

  entryBilled(entry: TimeEntry): number {
    return (entry.durationSeconds / 3600) * this.entryBillRate(entry);
  }

  filteredBilled(): number {
    return this.filteredEntries().reduce((acc, e) => acc + this.entryBilled(e), 0);
  }

  totalBilled(): number {
    return this.rangeEntries().reduce((acc, e) => acc + this.entryBilled(e), 0);
  }

  totalProfit(): number {
    return this.totalBilled() - this.totalPayrollExpense();
  }

  totalMargin(): number {
    const billed = this.totalBilled();
    return billed > 0 ? (this.totalProfit() / billed) * 100 : 0;
  }

  filteredSeconds(): number {
    return this.filteredEntries().reduce((acc, e) => acc + e.durationSeconds, 0);
  }

  filteredPay(): number {
    return this.filteredEntries().reduce((acc, e) => acc + (e.totalPay || 0), 0);
  }

  clientEarnings(): ClientEarningsSummary[] {
    const map = new Map<string, ClientEarningsSummary>();

    for (const entry of this.rangeEntries()) {
      let row = map.get(entry.clientId);
      if (!row) {
        const client = this.clients().find((c) => c.id === entry.clientId);
        row = {
          clientId: entry.clientId,
          clientName: client?.name || entry.clientName,
          color: client?.color || '#a87c2c',
          billRate: client?.defaultRate || 0,
          totalEntries: 0,
          totalSeconds: 0,
          totalHours: 0,
          billed: 0,
          teamCost: 0,
          profit: 0,
          margin: 0,
        };
        map.set(entry.clientId, row);
      }
      row.totalEntries++;
      row.totalSeconds += entry.durationSeconds;
      row.teamCost += entry.totalPay || 0;
      row.billed += this.entryBilled(entry);
    }

    for (const row of map.values()) {
      row.totalHours = row.totalSeconds / 3600;
      row.billRate = row.totalHours > 0 ? row.billed / row.totalHours : 0;
      row.profit = row.billed - row.teamCost;
      row.margin = row.billed > 0 ? (row.profit / row.billed) * 100 : 0;
    }

    return Array.from(map.values()).sort((a, b) => b.billed - a.billed);
  }

  memberClientEarnings(): MemberClientSummary[] {
    const map = new Map<string, MemberClientSummary & { seconds: number }>();

    for (const entry of this.rangeEntries()) {
      const key = `${entry.employeeId}|${entry.clientId}`;
      let row = map.get(key);
      if (!row) {
        const client = this.clients().find((c) => c.id === entry.clientId);
        row = {
          key,
          employeeName: entry.employeeName,
          clientName: client?.name || entry.clientName,
          payRate: entry.hourlyRate,
          billRate: client?.defaultRate || 0,
          seconds: 0,
          totalHours: 0,
          billed: 0,
          teamCost: 0,
          profit: 0,
        };
        map.set(key, row);
      }
      row.seconds += entry.durationSeconds;
      row.teamCost += entry.totalPay || 0;
      row.billed += this.entryBilled(entry);
    }

    return Array.from(map.values())
      .map((row) => {
        row.totalHours = row.seconds / 3600;
        row.billRate = row.totalHours > 0 ? row.billed / row.totalHours : row.billRate;
        row.profit = row.billed - row.teamCost;
        // Average pay rate across entries (rates can change mid-period)
        row.payRate = row.totalHours > 0 ? row.teamCost / row.totalHours : row.payRate;
        return row;
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || b.billed - a.billed);
  }

  filteredEntries(): TimeEntry[] {
    const q = this.searchQuery().toLowerCase().trim();
    const empFilter = this.selectedFilterEmployee();
    const cliFilter = this.selectedFilterClient();

    return this.rangeEntries().filter((e) => {
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

    for (const entry of this.rangeEntries()) {
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

    for (const entry of this.rangeEntries()) {
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

  // --- Timesheets (grouped by day, like WebWork View & Edit Timesheet) ---

  timesheetDays(): TimesheetDay[] {
    const entries = [...this.filteredEntries()].sort((a, b) => b.startTime - a.startTime);
    const byDay = new Map<string, TimeEntry[]>();
    for (const e of entries) {
      const key = this.dayKey(new Date(e.startTime));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }

    // When one member is picked, also show the days they didn't work (max 62 days)
    const start = this.rangeStart();
    const end = this.rangeEnd();
    const showEmpty = this.selectedFilterEmployee() !== 'ALL' && !!start && !!end;
    const keys: string[] = [];
    if (showEmpty && (end!.getTime() - start!.getTime()) / DAY_MS <= 62) {
      for (let d = new Date(end!); d >= start!; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)) {
        keys.push(this.dayKey(d));
      }
    } else {
      keys.push(...byDay.keys());
    }

    return keys.map((key) => {
      const list = byDay.get(key) || [];
      const [y, m, d] = key.split('-').map(Number);
      return {
        key,
        label: new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
        seconds: list.reduce((acc, e) => acc + e.durationSeconds, 0),
        entries: list,
      };
    });
  }

  private dayKey(d: Date): string {
    return this.toDateInput(d);
  }

  // --- Real Time (who is working now) ---

  realTimeRows(): RealTimeRow[] {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const order = { working: 0, break: 1, off: 2 };

    return this.employees()
      .filter((e) => e.active)
      .map((employee) => {
        const mine = this.entries().filter((e) => e.employeeId === employee.id);
        const live = mine.find((e) => e.status === 'active' || e.status === 'paused') || null;
        const todaySeconds = mine
          .filter((e) => e.startTime >= todayStart.getTime())
          .reduce((acc, e) => acc + e.durationSeconds, 0);
        const lastSeen = mine.reduce<number | null>((acc, e) => Math.max(acc ?? 0, e.endTime || e.startTime), null);
        const status: RealTimeRow['status'] = live ? (live.status === 'active' ? 'working' : 'break') : 'off';
        return { employee, status, entry: live, todaySeconds, lastSeen };
      })
      .sort((a, b) => order[a.status] - order[b.status] || b.todaySeconds - a.todaySeconds);
  }

  workingNowCount(): number {
    return this.realTimeRows().filter((r) => r.status === 'working').length;
  }

  onBreakCount(): number {
    return this.realTimeRows().filter((r) => r.status === 'break').length;
  }

  // --- Tracked Hours report (member × project × day) ---

  trackedColumns(): { byMonth: boolean; cols: { key: string; label: string }[] } {
    const entries = this.rangeEntries();
    let start = this.rangeStart();
    let end = this.rangeEnd();
    if (!start || !end) {
      if (entries.length === 0) return { byMonth: false, cols: [] };
      const times = entries.map((e) => e.startTime);
      start = start ?? new Date(Math.min(...times));
      end = end ?? new Date(Math.max(...times));
    }
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    const cols: { key: string; label: string }[] = [];

    if (days <= 31) {
      for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        cols.push({ key: this.dayKey(d), label: d.toLocaleDateString([], { month: 'short', day: 'numeric', weekday: 'short' }) });
      }
      return { byMonth: false, cols };
    }
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      cols.push({ key: this.monthKey(d), label: d.toLocaleDateString([], { month: 'short', year: 'numeric' }) });
    }
    return { byMonth: true, cols };
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  trackedRows(): TrackedRow[] {
    const byMonth = this.trackedColumns().byMonth;
    const map = new Map<string, TrackedRow>();
    for (const e of this.rangeEntries()) {
      const key = `${e.employeeId}|${e.clientId}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          employeeName: e.employeeName,
          clientName: this.clientName(e.clientId) || e.clientName,
          cells: {},
          total: { seconds: 0, pay: 0, bill: 0 },
        };
        map.set(key, row);
      }
      const d = new Date(e.startTime);
      const col = byMonth ? this.monthKey(d) : this.dayKey(d);
      const cell = (row.cells[col] ??= { seconds: 0, pay: 0, bill: 0 });
      const bill = this.entryBilled(e);
      cell.seconds += e.durationSeconds;
      cell.pay += e.totalPay || 0;
      cell.bill += bill;
      row.total.seconds += e.durationSeconds;
      row.total.pay += e.totalPay || 0;
      row.total.bill += bill;
    }
    return Array.from(map.values()).sort(
      (a, b) => a.employeeName.localeCompare(b.employeeName) || b.total.seconds - a.total.seconds
    );
  }

  trackedColumnTotal(col: string): { seconds: number; pay: number; bill: number } {
    const t = { seconds: 0, pay: 0, bill: 0 };
    for (const row of this.trackedRows()) {
      const c = row.cells[col];
      if (c) {
        t.seconds += c.seconds;
        t.pay += c.pay;
        t.bill += c.bill;
      }
    }
    return t;
  }

  trackedGrandTotal(): { seconds: number; pay: number; bill: number } {
    return {
      seconds: this.totalTrackedSeconds(),
      pay: this.totalPayrollExpense(),
      bill: this.totalBilled(),
    };
  }

  trackedCell(cell?: { seconds: number; pay: number; bill: number }): string {
    if (!cell || cell.seconds === 0) return this.trackedMode() === 'hours' ? '0:00' : '—';
    if (this.trackedMode() === 'hours') {
      const mins = Math.round(cell.seconds / 60);
      return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    }
    return this.money.transform(this.trackedMode() === 'pay' ? cell.pay : cell.bill);
  }

  exportTrackedCSV(): void {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const { cols } = this.trackedColumns();
    const mode = this.trackedMode();
    const val = (c?: { seconds: number; pay: number; bill: number }) =>
      !c ? '0' : mode === 'hours' ? (c.seconds / 3600).toFixed(2) : (mode === 'pay' ? c.pay : c.bill).toFixed(2);
    const headers = ['Member', 'Project', ...cols.map((c) => q(c.label)), `Total (${mode === 'hours' ? 'hours' : CURRENCY_CODE})`];
    const rows = this.trackedRows().map((r) => [q(r.employeeName), q(r.clientName), ...cols.map((c) => val(r.cells[c.key])), val(r.total)]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.downloadFile(csv, `auravia_tracked_${mode}_${this.rangeFileTag()}.csv`, 'text/csv');
  }

  // --- Team Pay & payouts ---

  payRows(): PayRow[] {
    return this.employeeReports().map((rep) => {
      const projects = [
        ...new Set(this.rangeEntries().filter((e) => e.employeeId === rep.employeeId).map((e) => this.clientName(e.clientId) || e.clientName)),
      ];
      return {
        employeeId: rep.employeeId,
        employeeName: rep.employeeName,
        projects,
        totalHours: rep.totalHours,
        totalPay: rep.totalPay,
        avgRate: rep.totalHours > 0 ? rep.totalPay / rep.totalHours : rep.hourlyRate,
        payout: this.payoutFor(rep.employeeId),
      };
    });
  }

  /** Paying needs a closed date range (a pay period), not "All time". */
  canMarkPaid(): boolean {
    return !!this.rangeStart() && !!this.rangeEnd();
  }

  private payoutFor(employeeId: string): Payout | null {
    const start = this.rangeStart()?.getTime();
    const end = this.rangeEnd()?.getTime();
    if (start == null || end == null) return null;
    return this.payouts().find((p) => p.employeeId === employeeId && p.periodStart === start && p.periodEnd === end) || null;
  }

  async markPaid(row: PayRow): Promise<void> {
    if (!this.canMarkPaid()) return;
    const ok = confirm(`Record that ${row.employeeName} was paid ${this.money.transform(row.totalPay)} for ${this.rangeLabel()}?`);
    if (!ok) return;
    await this.db.savePayout({
      id: 'pay_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      periodStart: this.rangeStart()!.getTime(),
      periodEnd: this.rangeEnd()!.getTime(),
      hours: parseFloat(row.totalHours.toFixed(2)),
      amount: parseFloat(row.totalPay.toFixed(2)),
      paidAt: Date.now(),
    });
    this.payouts.set(await this.db.getPayouts());
  }

  async undoPayout(id: string): Promise<void> {
    if (!confirm('Remove this payment record? (This does not move any money — it only changes the record.)')) return;
    await this.db.deletePayout(id);
    this.payouts.set(await this.db.getPayouts());
  }

  totalPaidInRange(): number {
    return this.payRows().reduce((acc, r) => acc + (r.payout?.amount || 0), 0);
  }

  payoutHistory(): Payout[] {
    return [...this.payouts()].sort((a, b) => b.paidAt - a.paidAt);
  }

  // --- Manual time ---

  isManual(entry: TimeEntry): boolean {
    return entry.id.startsWith(MANUAL_ENTRY_PREFIX);
  }

  private manualShare(entries: TimeEntry[]): number {
    const total = entries.reduce((acc, e) => acc + e.durationSeconds, 0);
    const manual = entries.filter((e) => this.isManual(e)).reduce((acc, e) => acc + e.durationSeconds, 0);
    return total > 0 ? (manual / total) * 100 : 0;
  }

  manualPercent(): number {
    return this.manualShare(this.filteredEntries());
  }

  memberManualPercent(employeeId: string): number {
    return this.manualShare(this.rangeEntries().filter((e) => e.employeeId === employeeId));
  }

  // --- Timesheet approval ---

  approvalFor(employeeId: string): TimesheetApproval | null {
    const start = this.rangeStart()?.getTime();
    const end = this.rangeEnd()?.getTime();
    if (start == null || end == null) return null;
    return this.approvals().find((a) => a.employeeId === employeeId && a.periodStart === start && a.periodEnd === end) || null;
  }

  approvalStatus(employeeId: string): 'none' | 'submitted' | 'approved' | 'rejected' {
    return this.approvalFor(employeeId)?.status ?? 'none';
  }

  approvalLabel(employeeId: string): string {
    const labels = { none: 'Not submitted', submitted: 'Waiting for approval', approved: 'Approved', rejected: 'Sent back' };
    return labels[this.approvalStatus(employeeId)];
  }

  approvalChanged(employeeId: string, hours: number): boolean {
    const a = this.approvalFor(employeeId);
    return !!a && a.status !== 'rejected' && a.hours.toFixed(2) !== hours.toFixed(2);
  }

  async setApproval(row: PayRow, status: 'approved' | 'rejected'): Promise<void> {
    if (!this.canMarkPaid()) return;
    let note: string | undefined;
    if (status === 'rejected') {
      const answer = prompt(`What should ${row.employeeName} fix? (optional)`);
      if (answer === null) return;
      note = answer.trim() || undefined;
    }
    const start = this.rangeStart()!.getTime();
    const existing = this.approvalFor(row.employeeId);
    await this.db.saveApproval({
      id: `${row.employeeId}_${start}`,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      periodStart: start,
      periodEnd: this.rangeEnd()!.getTime(),
      status,
      hours: parseFloat(row.totalHours.toFixed(2)),
      submittedAt: existing?.submittedAt ?? Date.now(),
      reviewedAt: Date.now(),
      note,
    });
    this.approvals.set(await this.db.getApprovals());
  }

  /** Open this member's timesheet for the same dates. */
  reviewTimesheet(employeeId: string): void {
    this.selectedFilterEmployee.set(employeeId);
    this.selectedFilterClient.set('ALL');
    this.goTo('timesheets');
  }

  // --- Inline editing (click a cell, change it, it saves) ---

  private flash(message: string): void {
    this.savedNote.set(message);
    setTimeout(() => this.savedNote.set(''), 2000);
  }

  async updateEmployee(emp: Employee, field: 'name' | 'email' | 'department' | 'role' | 'hourlyRate', raw: string): Promise<void> {
    const value = field === 'hourlyRate' ? Math.max(0, Number(raw) || 0) : String(raw).trim();
    if (field === 'name' && !value) return;
    const updated: Employee = { ...emp, [field]: value } as Employee;
    await this.db.saveEmployee(updated);
    if (this.authService.currentUser()?.id === emp.id) this.authService.currentUser.set(updated);
    this.employees.set(this.employees().map((e) => (e.id === emp.id ? updated : e)));
    this.flash(`Saved ${updated.name}`);
  }

  async updateClient(cli: Client, field: 'name' | 'code' | 'defaultRate', raw: string): Promise<void> {
    const value =
      field === 'defaultRate' ? Math.max(0, Number(raw) || 0) : field === 'code' ? String(raw).trim().toUpperCase() : String(raw).trim();
    if (field === 'name' && !value) return;
    const updated: Client = { ...cli, [field]: value } as Client;
    await this.db.saveClient(updated);
    this.clients.set(this.clients().map((c) => (c.id === cli.id ? updated : c)));
    this.flash(`Saved ${updated.name}`);
  }

  async updateContract(c: Contract, field: 'payRate' | 'billRate' | 'weeklyLimitHours', raw: string): Promise<void> {
    const n = Number(raw);
    const value = field === 'weeklyLimitHours' ? (raw === '' || !n ? undefined : Math.max(0, n)) : Math.max(0, n || 0);
    const updated: Contract = { ...c, [field]: value };
    await this.db.saveContract(updated);
    this.contracts.set(this.contracts().map((x) => (x.id === c.id ? updated : x)));
    this.flash(`Saved rate for ${this.employeeName(c.employeeId)} · ${this.clientName(c.clientId)}`);
  }

  async updatePayout(p: Payout, field: 'amount' | 'paidAt' | 'note', raw: string): Promise<void> {
    let value: number | string | undefined;
    if (field === 'amount') value = Math.max(0, Number(raw) || 0);
    else if (field === 'paidAt') {
      const d = this.parseDateInput(raw);
      if (!d) return;
      value = d.getTime() + 12 * 60 * 60 * 1000; // midday, so time zones don't shift the date
    } else value = String(raw).trim() || undefined;
    const updated: Payout = { ...p, [field]: value } as Payout;
    await this.db.savePayout(updated);
    this.payouts.set(this.payouts().map((x) => (x.id === p.id ? updated : x)));
    this.flash(`Saved payment for ${p.employeeName}`);
  }

  toDateInputMs(ms: number): string {
    return this.toDateInput(new Date(ms));
  }

  /** From Client Earnings: jump to that client's contracts to change rates. */
  editClientRates(clientId: string): void {
    this.contractFilterClient.set(clientId);
    this.goTo('contracts');
  }

  // --- Home / overview ---

  currentPeriodRange(): [Date, Date] {
    return payPeriodFor(new Date());
  }

  lastPeriodRange(): [Date, Date] {
    return previousPayPeriod(new Date());
  }

  periodLabel(range: [Date, Date]): string {
    return formatPeriod(...range);
  }

  private entriesIn([start, end]: [Date, Date]): TimeEntry[] {
    const s = start.getTime();
    const e = end.getTime() + DAY_MS;
    return this.entries().filter((x) => x.startTime >= s && x.startTime < e);
  }

  periodTotals(range: [Date, Date]): { hours: number; pay: number; billed: number } {
    const list = this.entriesIn(range);
    return {
      hours: list.reduce((a, e) => a + e.durationSeconds, 0) / 3600,
      pay: list.reduce((a, e) => a + (e.totalPay || 0), 0),
      billed: list.reduce((a, e) => a + this.entryBilled(e), 0),
    };
  }

  /** Payday = last day of the current pay period (the 15th, or the end of the month). */
  paydayDaysLeft(): number {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return Math.max(0, Math.round((this.currentPeriodRange()[1].getTime() - todayStart) / DAY_MS));
  }

  approvalCount([start]: [Date, Date], status: 'submitted' | 'approved'): number {
    return this.approvals().filter((a) => a.periodStart === start.getTime() && a.status === status).length;
  }

  activeMembersWithTime(range: [Date, Date]): number {
    return new Set(this.entriesIn(range).map((e) => e.employeeId)).size;
  }

  /** People who worked last period but have no "paid" record for it. */
  unpaidLastPeriod(): string[] {
    const range = this.lastPeriodRange();
    const [start, end] = [range[0].getTime(), range[1].getTime()];
    const worked = new Map<string, string>();
    for (const e of this.entriesIn(range)) {
      if ((e.totalPay || 0) > 0) worked.set(e.employeeId, e.employeeName);
    }
    return [...worked.entries()]
      .filter(([id]) => !this.payouts().some((p) => p.employeeId === id && p.periodStart === start && p.periodEnd === end))
      .map(([, name]) => name);
  }

  /** Open a page with the dates set to a pay period. */
  openPeriodPage(tab: AdminTab, [start, end]: [Date, Date]): void {
    const current = this.currentPeriodRange()[0].getTime();
    const last = this.lastPeriodRange()[0].getTime();
    this.rangePreset.set(start.getTime() === current ? 'this-period' : start.getTime() === last ? 'last-period' : 'custom');
    this.rangeStart.set(start);
    this.rangeEnd.set(end);
    this.goTo(tab);
  }

  // --- Project detail (team and rates on one project) ---

  openProjectDetail(clientId: string): void {
    this.projectDetailId.set(clientId);
  }

  projectDefaultRate(clientId: string): number {
    return this.clients().find((c) => c.id === clientId)?.defaultRate || 0;
  }

  projectTeam(clientId: string): {
    employeeId: string;
    name: string;
    contract: boolean;
    payRate: number;
    billRate: number;
    hours: number;
    pay: number;
    billed: number;
  }[] {
    const ids = new Set(this.contracts().filter((c) => c.clientId === clientId && c.active).map((c) => c.employeeId));
    const periodEntries = this.entriesIn(this.currentPeriodRange()).filter((e) => e.clientId === clientId);
    periodEntries.forEach((e) => ids.add(e.employeeId));
    return [...ids]
      .map((id) => {
        const emp = this.employees().find((e) => e.id === id);
        const mine = periodEntries.filter((e) => e.employeeId === id);
        return {
          employeeId: id,
          name: emp?.name || mine[0]?.employeeName || 'Removed member',
          contract: this.contracts().some((c) => c.employeeId === id && c.clientId === clientId && c.active),
          payRate: payRateFor(this.contracts(), emp, clientId),
          billRate: billRateFor(this.contracts(), this.clients(), id, clientId),
          hours: mine.reduce((a, e) => a + e.durationSeconds, 0) / 3600,
          pay: mine.reduce((a, e) => a + (e.totalPay || 0), 0),
          billed: mine.reduce((a, e) => a + this.entryBilled(e), 0),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  addMemberToProject(clientId: string): void {
    this.projectDetailId.set(null);
    this.contractFilterClient.set(clientId);
    this.openAddContractModal();
  }

  // --- Team Access ---

  teamMembers(): Employee[] {
    return this.employees().filter((e) => e.role !== 'admin');
  }

  defaultPermissions(): MemberPermissions {
    return { ...DEFAULT_MEMBER_PERMISSIONS, ...(this.permissionRows().find((r) => r.id === 'default')?.permissions ?? {}) };
  }

  memberPermissions(emp: Employee): MemberPermissions {
    return effectivePermissions(this.permissionRows(), emp);
  }

  hasOwnPermissions(employeeId: string): boolean {
    return this.permissionRows().some((r) => r.id === employeeId);
  }

  async setPermission(id: string, key: keyof MemberPermissions, value: boolean): Promise<void> {
    const current =
      id === 'default' ? this.defaultPermissions() : this.memberPermissions(this.employees().find((e) => e.id === id)!);
    await this.db.savePermission({ id, permissions: { ...current, [key]: value } });
    this.permissionRows.set(await this.db.getPermissions());
    this.flash('Team access saved');
  }

  async resetPermissions(employeeId: string): Promise<void> {
    await this.db.deletePermission(employeeId);
    this.permissionRows.set(await this.db.getPermissions());
    this.flash('Now uses the Everyone setting');
  }

  // --- Payments ---

  openPayslip(p: Payout): void {
    this.payslipFor.set(p);
  }

  employeeEmail(id: string): string {
    return this.employees().find((e) => e.id === id)?.email || '';
  }

  totalPaidAllTime(): number {
    return this.payouts().reduce((acc, p) => acc + p.amount, 0);
  }

  exportPaymentsCSV(): void {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const headers = ['Paid On', 'Member', 'Period Start', 'Period End', 'Hours', `Amount (${CURRENCY_CODE})`];
    const rows = this.payoutHistory().map((p) => [
      q(new Date(p.paidAt).toLocaleString()),
      q(p.employeeName),
      q(this.formatDate(p.periodStart)),
      q(this.formatDate(p.periodEnd)),
      p.hours.toFixed(2),
      p.amount.toFixed(2),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.downloadFile(csv, `auravia_payments_${this.toDateInput(new Date())}.csv`, 'text/csv');
  }

  // --- Projects & Contracts ---

  employeeName(id: string): string {
    return this.employees().find((e) => e.id === id)?.name || 'Removed member';
  }

  clientName(id: string): string {
    return this.clients().find((c) => c.id === id)?.name || '';
  }

  projectHours(clientId: string): number {
    return this.entries().filter((e) => e.clientId === clientId).reduce((acc, e) => acc + e.durationSeconds, 0) / 3600;
  }

  projectMemberCount(clientId: string): number {
    const ids = new Set(this.contracts().filter((c) => c.clientId === clientId && c.active).map((c) => c.employeeId));
    this.entries().filter((e) => e.clientId === clientId).forEach((e) => ids.add(e.employeeId));
    return ids.size;
  }

  filteredContracts(): Contract[] {
    const f = this.contractFilterClient();
    return this.contracts()
      .filter((c) => f === 'ALL' || c.clientId === f)
      .sort((a, b) => this.employeeName(a.employeeId).localeCompare(this.employeeName(b.employeeId)));
  }

  /** Hours this member worked on this project in the current week (Mon–Sun). */
  contractWeekHours(c: Contract): number {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return (
      this.entries()
        .filter((e) => e.employeeId === c.employeeId && e.clientId === c.clientId && e.startTime >= monday.getTime())
        .reduce((acc, e) => acc + e.durationSeconds, 0) / 3600
    );
  }

  openAddContractModal(): void {
    this.editingContract.set(null);
    const clientId = this.contractFilterClient() !== 'ALL' ? this.contractFilterClient() : this.clients()[0]?.id || '';
    const emp = this.employees()[0];
    this.contractForm = {
      employeeId: emp?.id || '',
      clientId,
      payRate: emp?.hourlyRate || 0,
      billRate: this.clients().find((c) => c.id === clientId)?.defaultRate || 0,
      weeklyLimitHours: null,
    };
    this.showContractModal.set(true);
  }

  openEditContractModal(c: Contract): void {
    this.editingContract.set(c);
    this.contractForm = {
      employeeId: c.employeeId,
      clientId: c.clientId,
      payRate: c.payRate,
      billRate: c.billRate,
      weeklyLimitHours: c.weeklyLimitHours ?? null,
    };
    this.showContractModal.set(true);
  }

  async saveContractForm(): Promise<void> {
    const f = this.contractForm;
    if (!f.employeeId || !f.clientId) return;
    const editing = this.editingContract();
    // One contract per member per project
    const existing = this.contracts().find((c) => c.employeeId === f.employeeId && c.clientId === f.clientId && c.id !== editing?.id);
    if (existing && !confirm('This member already has a contract on this project. Replace it?')) return;
    if (existing) await this.db.deleteContract(existing.id);

    await this.db.saveContract({
      id: editing?.id || `con_${f.employeeId}_${f.clientId}`,
      employeeId: f.employeeId,
      clientId: f.clientId,
      payRate: Number(f.payRate) || 0,
      billRate: Number(f.billRate) || 0,
      weeklyLimitHours: f.weeklyLimitHours ? Number(f.weeklyLimitHours) : undefined,
      active: true,
    });
    this.showContractModal.set(false);
    this.contracts.set(await this.db.getContracts());
  }

  async deleteContract(id: string): Promise<void> {
    if (!confirm('Delete this contract? New time will use the default rates.')) return;
    await this.db.deleteContract(id);
    this.contracts.set(await this.db.getContracts());
  }

  // --- Add / Edit time ---

  openAddTimeModal(): void {
    this.editingEntry.set(null);
    this.timeFormError.set('');
    const emp = this.selectedFilterEmployee() !== 'ALL' ? this.selectedFilterEmployee() : this.employees()[0]?.id || '';
    const cli = this.selectedFilterClient() !== 'ALL' ? this.selectedFilterClient() : this.clients()[0]?.id || '';
    this.timeForm = { employeeId: emp, clientId: cli, date: this.toDateInput(new Date()), start: '09:00', end: '10:00', task: '' };
    this.showTimeModal.set(true);
  }

  openEditTimeModal(entry: TimeEntry): void {
    this.editingEntry.set(entry);
    this.timeFormError.set('');
    const hm = (ms: number) => {
      const d = new Date(ms);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    this.timeForm = {
      employeeId: entry.employeeId,
      clientId: entry.clientId,
      date: this.toDateInput(new Date(entry.startTime)),
      start: hm(entry.startTime),
      end: hm(entry.endTime || entry.startTime + entry.durationSeconds * 1000),
      task: entry.taskDescription,
    };
    this.showTimeModal.set(true);
  }

  timeFormPayRate(): number {
    const editing = this.editingEntry();
    // Keep the saved rate when member/project didn't change, so history stays the same
    if (editing && editing.employeeId === this.timeForm.employeeId && editing.clientId === this.timeForm.clientId) {
      return editing.hourlyRate;
    }
    const emp = this.employees().find((e) => e.id === this.timeForm.employeeId);
    return payRateFor(this.contracts(), emp, this.timeForm.clientId);
  }

  timeFormBillRate(): number {
    return billRateFor(this.contracts(), this.clients(), this.timeForm.employeeId, this.timeForm.clientId);
  }

  async saveTimeForm(): Promise<void> {
    const f = this.timeForm;
    const emp = this.employees().find((e) => e.id === f.employeeId);
    const cli = this.clients().find((c) => c.id === f.clientId);
    const day = this.parseDateInput(f.date);
    if (!emp || !cli || !day || !f.start || !f.end) {
      this.timeFormError.set('Please fill in member, project, date, start and end.');
      return;
    }
    const at = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
    };
    const startTime = at(f.start);
    let endTime = at(f.end);
    if (endTime <= startTime) endTime += DAY_MS; // shift past midnight
    const durationSeconds = Math.round((endTime - startTime) / 1000);
    if (durationSeconds > 16 * 3600) {
      this.timeFormError.set('That is more than 16 hours — please check the start and end times.');
      return;
    }

    const editing = this.editingEntry();
    const hourlyRate = this.timeFormPayRate();
    const entry: TimeEntry = {
      ...(editing || {
        id: MANUAL_ENTRY_PREFIX + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        pausedSeconds: 0,
        screenshotCount: 0,
      }),
      employeeId: emp.id,
      employeeName: emp.name,
      clientId: cli.id,
      clientName: cli.name,
      taskDescription: f.task.trim() || (editing ? editing.taskDescription : 'Manual time'),
      startTime,
      endTime,
      durationSeconds,
      status: 'completed',
      hourlyRate,
      totalPay: parseFloat(((durationSeconds / 3600) * hourlyRate).toFixed(2)),
    } as TimeEntry;

    await this.db.saveTimeEntry(entry);
    this.showTimeModal.set(false);
    await this.refreshAllData();
  }

  formatDateTimeShort(ms: number): string {
    return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // --- Modal Helpers ---

  openAddEmployeeModal(): void {
    this.editingEmployee.set(null);
    this.employeeForm = {
      name: '',
      email: '',
      hourlyRate: 0,
      role: 'user',
      department: '',
      pin: '',
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
      pin: emp.pin || '',
    };
    this.showEmployeeModal.set(true);
  }

  async saveEmployeeForm(): Promise<void> {
    if (!this.employeeForm.name.trim()) return;

    const editing = this.editingEmployee();
    const id = editing ? editing.id : 'emp_' + Date.now();

    const trimmedName = this.employeeForm.name.trim();
    const starterPin = AuthService.starterPinFor(trimmedName);
    const pin = this.employeeForm.pin?.trim() || editing?.pin || starterPin;
    const emp: Employee = {
      id,
      name: trimmedName,
      email: this.employeeForm.email.trim(),
      hourlyRate: Number(this.employeeForm.hourlyRate) || 0,
      role: this.employeeForm.role,
      department: this.employeeForm.department.trim(),
      avatarColor: editing?.avatarColor || this.getRandomColor(),
      pin,
      active: true,
    };

    await this.db.saveEmployee(emp);

    // If someone's PIN was reset by hand, this device should ask them to set their own
    // PIN again next time they sign in here, instead of remembering their old one.
    if (editing && editing.pin?.trim().toLowerCase() !== pin.toLowerCase()) {
      this.authService.clearPinConfirmation(emp.id);
    }

    // If currently logged in user is this employee, update the session user
    if (this.authService.currentUser()?.id === emp.id) {
      this.authService.currentUser.set(emp);
    }

    this.showEmployeeModal.set(false);
    await this.refreshAllData();
  }

  async deleteEmployee(id: string): Promise<void> {
    if (confirm('Are you sure you want to delete this employee?')) {
      await this.db.deleteEmployee(id);
      await this.refreshAllData();
    }
  }

  openAddClientModal(): void {
    this.editingClient.set(null);
    this.clientForm = {
      name: '',
      code: '',
      defaultRate: 0,
      color: '#a87c2c',
    };
    this.showClientModal.set(true);
  }

  openEditClientModal(cli: Client): void {
    this.editingClient.set(cli);
    this.clientForm = {
      name: cli.name,
      code: cli.code,
      defaultRate: cli.defaultRate || 0,
      color: cli.color || '#a87c2c',
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

    await this.db.saveClient(cli);
    this.showClientModal.set(false);
    await this.refreshAllData();
  }

  async deleteClient(id: string): Promise<void> {
    if (confirm('Are you sure you want to delete this client?')) {
      await this.db.deleteClient(id);
      await this.refreshAllData();
    }
  }

  async deleteEntry(id: string): Promise<void> {
    if (confirm('Delete this time entry and its associated screenshots?')) {
      await this.db.deleteTimeEntry(id);
      await this.refreshAllData();
    }
  }

  async viewEntryScreenshots(entryId: string): Promise<void> {
    const list = await this.db.getScreenshots(entryId);
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
      await this.db.saveSettings(curr);
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
      await this.db.saveSettings(curr);
      this.settings.set({ ...curr });
      this.newAdminPin = '';
      this.pinSaved.set(true);
      setTimeout(() => this.pinSaved.set(false), 3000);
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
      `Pay Rate (${CURRENCY_CODE}/hr)`,
      `Pay (${CURRENCY_CODE})`,
      `Bill (${CURRENCY_CODE})`,
      'Screenshot Count',
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
      this.entryBilled(e).toFixed(2),
      e.screenshotCount || 0,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.downloadFile(csvContent, `auravia_time_records_${this.rangeFileTag()}.csv`, 'text/csv');
  }

  exportPayrollReportCSV(): void {
    const headers = [
      'Period',
      'Employee ID',
      'Employee Name',
      `Pay Rate (${CURRENCY_CODE}/hr)`,
      'Total Shifts',
      'Total Hours Worked',
      'Screenshots Audited',
      `Amount to Pay (${CURRENCY_CODE})`,
      'Paid',
    ];

    const period = `"${this.rangeLabel()}"`;
    const rows = this.employeeReports().map((r) => [
      period,
      r.employeeId,
      `"${r.employeeName.replace(/"/g, '""')}"`,
      r.hourlyRate.toFixed(2),
      r.totalEntries,
      r.totalHours.toFixed(2),
      r.screenshotCount,
      r.totalPay.toFixed(2),
      this.payoutFor(r.employeeId) ? 'Yes' : 'No',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.downloadFile(csvContent, `auravia_team_pay_${this.rangeFileTag()}.csv`, 'text/csv');
  }

  exportEarningsCSV(): void {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const headers = [
      'Period',
      'Client',
      `Avg Bill Rate (${CURRENCY_CODE}/hr)`,
      'Hours',
      `You Receive (${CURRENCY_CODE})`,
      `You Pay Team (${CURRENCY_CODE})`,
      `Margin (${CURRENCY_CODE})`,
      'Margin (%)',
    ];
    const period = q(this.rangeLabel());
    const rows = this.clientEarnings().map((c) => [
      period,
      q(c.clientName),
      c.billRate.toFixed(2),
      c.totalHours.toFixed(2),
      c.billed.toFixed(2),
      c.teamCost.toFixed(2),
      c.profit.toFixed(2),
      c.margin.toFixed(1),
    ]);
    rows.push([
      period,
      q('TOTAL'),
      '',
      (this.totalTrackedSeconds() / 3600).toFixed(2),
      this.totalBilled().toFixed(2),
      this.totalPayrollExpense().toFixed(2),
      this.totalProfit().toFixed(2),
      this.totalMargin().toFixed(1),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.downloadFile(csvContent, `auravia_client_earnings_${this.rangeFileTag()}.csv`, 'text/csv');
  }

  private rangeFileTag(): string {
    const from = this.rangeFromInput() || 'start';
    const to = this.rangeToInput() || 'today';
    return `${from}_to_${to}`;
  }

  async exportBackup(): Promise<void> {
    const json = await this.db.exportAllData();
    this.downloadFile(json, `auravia_time_backup_${Date.now()}.json`, 'application/json');
  }

  async importBackup(event: any): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await this.db.importData(reader.result as string);
        await this.refreshAllData();
        alert('Data imported successfully!');
      } catch (e) {
        alert('Failed to import data: ' + e);
      }
    };
    reader.readAsText(file);
  }

  // --- Import time entries from CSV ---

  downloadTimeImportTemplate(): void {
    const rows = [
      ['Employee ID', 'Client ID', 'Date', 'Start', 'End', 'Task'],
      [this.employees()[0]?.id || 'emp-1', this.clients()[0]?.id || 'cli-1', this.toDateInput(new Date()), '09:00', '17:00', 'Example task'],
    ];
    this.downloadFile(rows.map((r) => r.join(',')).join('\n'), 'auravia_time_import_template.csv', 'text/csv');
  }

  private parseCsv(text: string): string[][] {
    // Handles quoted fields with commas, matching how our own CSV exports quote text.
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
    }
    return rows;
  }

  async importTimeCSV(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.csvImportBusy.set(true);
    this.csvImportResult.set(null);
    try {
      const text = await file.text();
      const rows = this.parseCsv(text);
      if (!rows.length) {
        this.csvImportResult.set({ total: 0, added: 0, errors: ['The file is empty.'] });
        return;
      }
      // Skip a header row if the first cell isn't a known employee id (so both templates and quick edits work)
      const empIds = new Set(this.employees().map((e) => e.id));
      const dataRows = empIds.has(rows[0][0]?.trim()) ? rows : rows.slice(1);

      const errors: string[] = [];
      let added = 0;
      for (let i = 0; i < dataRows.length; i++) {
        const line = i + (dataRows === rows ? 1 : 2); // for messages, matches the row number in the file
        const [empId, cliId, dateStr, start, end, ...taskParts] = dataRows[i].map((c) => c.trim());
        const task = taskParts.join(',').trim();
        const emp = this.employees().find((e) => e.id === empId);
        const cli = this.clients().find((c) => c.id === cliId);
        const day = this.parseDateInput(dateStr);
        if (!emp) {
          errors.push(`Row ${line}: unknown Employee ID "${empId}".`);
          continue;
        }
        if (!cli) {
          errors.push(`Row ${line}: unknown Client ID "${cliId}".`);
          continue;
        }
        if (!day || !/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
          errors.push(`Row ${line}: check the date/start/end format.`);
          continue;
        }
        const at = (hhmm: string) => {
          const [h, m] = hhmm.split(':').map(Number);
          return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
        };
        const startTime = at(start);
        let endTime = at(end);
        if (endTime <= startTime) endTime += DAY_MS;
        const durationSeconds = Math.round((endTime - startTime) / 1000);
        if (durationSeconds > 16 * 3600) {
          errors.push(`Row ${line}: more than 16 hours — check start and end.`);
          continue;
        }
        const hourlyRate = payRateFor(this.contracts(), emp, cli.id);
        const entry: TimeEntry = {
          id: `${MANUAL_ENTRY_PREFIX}csv_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
          employeeId: emp.id,
          employeeName: emp.name,
          clientId: cli.id,
          clientName: cli.name,
          taskDescription: task || 'Imported from CSV',
          startTime,
          endTime,
          durationSeconds,
          pausedSeconds: 0,
          status: 'completed',
          hourlyRate,
          totalPay: parseFloat(((durationSeconds / 3600) * hourlyRate).toFixed(2)),
          screenshotCount: 0,
        };
        await this.db.saveTimeEntry(entry);
        added++;
      }
      this.csvImportResult.set({ total: dataRows.length, added, errors });
      if (added > 0) await this.refreshAllData();
    } catch (e) {
      this.csvImportResult.set({ total: 0, added: 0, errors: [`Could not read the file: ${e}`] });
    } finally {
      this.csvImportBusy.set(false);
      input.value = '';
    }
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
    const colors = ['#063c35', '#a87c2c', '#0a5248', '#7d8b6a', '#b5835a', '#4f6f5f'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
