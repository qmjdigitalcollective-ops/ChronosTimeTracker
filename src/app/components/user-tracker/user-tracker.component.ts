import { Component, OnInit, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { TimerService } from '../../services/timer.service';
import { AuthService } from '../../services/auth.service';
import { FormatDurationPipe } from '../../pipes/format-duration.pipe';
import { MoneyPipe } from '../../pipes/money.pipe';
import { Client, MemberPermissions, Payout, TimeEntry, TimesheetApproval } from '../../models/time-tracker.models';
import { DEFAULT_MEMBER_PERMISSIONS, effectivePermissions } from '../../services/permissions';
import { IconComponent } from '../icon/icon.component';
import { PayslipComponent } from '../payslip/payslip.component';
import { formatPeriod, payPeriodFor, previousPayPeriod } from '../../services/pay-period';

@Component({
  selector: 'app-user-tracker',
  standalone: true,
  imports: [CommonModule, FormsModule, FormatDurationPipe, MoneyPipe, IconComponent, PayslipComponent],
  template: `
    <div class="tracker-page" [class.no-money]="!perms().showEarnings" [class.no-pay-panel]="!perms().showPayPanel">
      <!-- Main Tracking Card -->
      <div class="tracker-card">
        <!-- User Info Strip (Locked to Logged In User) -->
        <div class="user-strip">
          <div class="user-profile">
            <div class="avatar" [style.background]="authService.currentUser()?.avatarColor || '#a87c2c'">
              {{ getInitials(authService.currentUser()?.name) }}
            </div>
            <div>
              <div class="user-name">
                <span>{{ authService.currentUser()?.name }}</span>
              </div>
              <div class="user-role-badge">
                {{ authService.currentUser()?.department || 'Team member' }}
              </div>
            </div>
          </div>

          <div class="shift-status-pill" [ngClass]="timerService.status()">
            <span class="status-dot"></span>
            <span class="status-label">
              @if (timerService.status() === 'active') { CLOCKED IN }
              @else if (timerService.status() === 'paused') { PAUSED }
              @else { READY TO CLOCK IN }
            </span>
          </div>
        </div>

        <!-- Task & Client Selection -->
        <div class="selection-grid">
          <div class="form-group">
            <label class="form-label">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              </svg>
              Select Project
            </label>
            <select
              class="form-select"
              [ngModel]="selectedClientId()"
              (ngModelChange)="selectedClientId.set($event)"
              [disabled]="timerService.status() !== 'completed'"
            >
              @for (cli of clients(); track cli.id) {
                <option [value]="cli.id">
                  {{ cli.name }} ({{ cli.code }})
                </option>
              }
            </select>
          </div>

          <div class="form-group flex-2">
            <label class="form-label">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <polyline points="9 11 12 14 22 4"></polyline>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
              What are you working on?
            </label>
            <input
              type="text"
              class="form-input"
              placeholder="e.g. Writing captions for VIRAL"
              [ngModel]="taskDescription()"
              (ngModelChange)="taskDescription.set($event)"
              [disabled]="timerService.status() !== 'completed'"
              (keydown.enter)="onClockInClick()"
            />
          </div>
        </div>

        <!-- Quick Task Suggestion Chips (when idle) -->
        @if (timerService.status() === 'completed') {
          <div class="suggestions-row">
            <span class="suggest-label">Suggestions:</span>
            <button type="button" class="chip" (click)="taskDescription.set('Client work')">Client work</button>
            <button type="button" class="chip" (click)="taskDescription.set('Content creation')">Content</button>
            <button type="button" class="chip" (click)="taskDescription.set('Admin & emails')">Admin & emails</button>
            <button type="button" class="chip" (click)="taskDescription.set('Client Sync & Project Planning')">Meeting</button>
          </div>
        }

        <!-- Big Timer Display -->
        <div class="timer-display-wrap">
          <div class="timer-digits">
            {{ timerService.elapsedSeconds() | formatDuration }}
          </div>

          <div class="session-sub-info">
            @if (timerService.status() === 'active' || timerService.status() === 'paused') {
              <span class="money-item">
                Earned this session:
                <strong class="earned-text">
                  {{ calculateEarned(timerService.elapsedSeconds()) | money }}
                </strong>
              </span>
              @if (timerService.pausedSeconds() > 0) {
                <span class="paused-text">
                  • Paused: {{ timerService.pausedSeconds() | formatDuration }}
                </span>
              }
            } @else {
              <span class="idle-text">Choose a project and task, then start tracking</span>
            }
          </div>
        </div>

        <!-- Control Action Buttons -->
        <div class="actions-row">
          @if (timerService.status() === 'completed') {
            <button
              type="button"
              class="btn btn-clock-in"
              (click)="onClockInClick()"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>Start Tracking</span>
            </button>
          } @else if (timerService.status() === 'active') {
            <button
              type="button"
              class="btn btn-pause"
              (click)="timerService.pause()"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
              <span>Pause Shift</span>
            </button>

            <button
              type="button"
              class="btn btn-clock-out"
              (click)="onClockOutClick()"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2"></rect>
              </svg>
              <span>Clock Out</span>
            </button>
          } @else if (timerService.status() === 'paused') {
            <button
              type="button"
              class="btn btn-resume"
              (click)="timerService.resume()"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.2" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>Resume Shift</span>
            </button>

            <button
              type="button"
              class="btn btn-clock-out"
              (click)="onClockOutClick()"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2"></rect>
              </svg>
              <span>Clock Out</span>
            </button>
          }
        </div>
      </div>

      <!-- My pay period (what I've earned and whether it's been paid) -->
      @if (perms().showPayPanel) {
      <div class="pay-card">
        <div class="pay-card-head">
          <div>
            <span class="eyebrow">My Pay Period</span>
            <h3 class="pay-card-title">{{ currentPeriodLabel }}</h3>
          </div>
          <span class="pay-status" [attr.data-status]="periodStatus(currentPeriod)">
            <app-icon [name]="periodStatus(currentPeriod) === 'paid' || periodStatus(currentPeriod) === 'approved' ? 'check' : 'clock'" [size]="14" />
            {{ statusLabel(periodStatus(currentPeriod)) }}
          </span>
        </div>
        @if (approvalFor(currentPeriod)?.status === 'rejected') {
          <div class="sent-back">
            <app-icon name="alert" [size]="15" />
            Your timesheet was sent back{{ approvalFor(currentPeriod)?.note ? ': ' + approvalFor(currentPeriod)?.note : '.' }}
            Please check your time, then submit again.
          </div>
        }
        <div class="pay-stats">
          <div class="pay-stat week">
            <span class="pay-stat-label">This week · {{ weekLabel }}</span>
            <span class="pay-stat-value small">
              {{ periodSeconds(thisWeek) / 3600 | number:'1.2-2' }} hrs
              <span class="week-earn money-item">{{ periodPay(thisWeek) | money }}</span>
            </span>
          </div>
          <div class="pay-stat">
            <span class="pay-stat-label">Pay period hours</span>
            <span class="pay-stat-value">{{ periodSeconds(currentPeriod) / 3600 | number:'1.2-2' }}</span>
          </div>
          <div class="pay-stat money-item">
            <span class="pay-stat-label">Pay period earnings</span>
            <span class="pay-stat-value gold">{{ periodPay(currentPeriod) | money }}</span>
          </div>
          <div class="pay-stat">
            <span class="pay-stat-label">Last period · {{ lastPeriodLabel }}</span>
            <span class="pay-stat-value small">
              <span class="money-item">{{ periodPay(lastPeriod) | money }}</span>
              <span class="pay-mini" [attr.data-status]="periodStatus(lastPeriod)">{{ statusLabel(periodStatus(lastPeriod)) }}</span>
              @if (lastPayout(); as paid) {
                <button type="button" class="slip-link" (click)="payslipFor.set(paid)">View payslip</button>
              }
            </span>
          </div>
        </div>
        @if (perms().submitTimesheet) {
        <div class="pay-actions">
          @if (canSubmit(lastPeriod)) {
            <button type="button" class="btn-submit-ts" (click)="submitTimesheet(lastPeriod)">
              Submit last period ({{ lastPeriodLabel }})
            </button>
          }
          @if (canSubmit(currentPeriod)) {
            <button type="button" class="btn-submit-ts outline" (click)="submitTimesheet(currentPeriod)">
              Submit this period's timesheet
            </button>
          }
        </div>
        }
      </div>
      }

      <!-- Today's Work Summary (Only for the logged in user) -->
      <div class="history-card">
        <div class="history-header">
          <div class="history-title-group">
            <h3 class="history-title">My Time</h3>
            @if (perms().viewHistory) {
            <div class="seg">
              <button type="button" [class.active]="historyView() === 'today'" (click)="historyView.set('today')">Today</button>
              <button type="button" [class.active]="historyView() === 'week'" (click)="historyView.set('week')">Week</button>
              <button type="button" [class.active]="historyView() === 'period'" (click)="historyView.set('period')">Pay period</button>
              <button type="button" [class.active]="historyView() === 'custom'" (click)="historyView.set('custom')">Custom</button>
            </div>
            }
            @if (historyView() === 'week') {
              <div class="range-nav">
                <button type="button" class="step" title="Previous week" (click)="weekOffset.set(weekOffset() - 1)">‹</button>
                <span class="range-label">{{ historyRangeLabel() }}</span>
                <button type="button" class="step" title="Next week" [disabled]="weekOffset() >= 0" (click)="weekOffset.set(weekOffset() + 1)">›</button>
              </div>
            } @else if (historyView() === 'custom') {
              <div class="range-nav">
                <input type="date" class="date-in" [ngModel]="customFrom()" (ngModelChange)="customFrom.set($event)" />
                <span class="text-muted">to</span>
                <input type="date" class="date-in" [ngModel]="customTo()" (ngModelChange)="customTo.set($event)" />
              </div>
            } @else if (historyView() === 'period') {
              <span class="range-label">{{ currentPeriodLabel }}</span>
            }
          </div>

          <div class="history-totals">
            <div class="total-stat">
              <span class="stat-label">{{ historyView() === 'today' ? 'Time today' : 'Total time' }}</span>
              <span class="stat-value">{{ calculateUserTodaySeconds() | formatDuration }}</span>
            </div>
            <div class="total-stat money-item">
              <span class="stat-label">Earnings</span>
              <span class="stat-value highlight">{{ calculateUserTodayEarnings() | money }}</span>
            </div>
          </div>
        </div>

        @if (myShiftsToday().length === 0) {
          <div class="empty-history">
            {{ historyView() === 'today' ? 'No time tracked today yet. Start tracking above.' : 'No time tracked for these dates.' }}
          </div>
        } @else {
          <div class="table-container">
            <table class="shifts-table">
              <thead>
                <tr>
                  @if (historyView() !== 'today') {
                    <th>Date</th>
                  }
                  <th>Project</th>
                  <th>Task</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Duration</th>
                  <th class="money-item">Earnings</th>
                  <th>Sync Status</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of myShiftsToday(); track entry.id) {
                  <tr>
                    @if (historyView() !== 'today') {
                      <td class="date-td">{{ formatDay(entry.startTime) }}</td>
                    }
                    <td>
                      <span class="client-tag">{{ entry.clientName }}</span>
                    </td>
                    <td class="task-cell">{{ entry.taskDescription }}</td>
                    <td>{{ formatTime(entry.startTime) }}</td>
                    <td>{{ entry.endTime ? formatTime(entry.endTime) : 'In Progress' }}</td>
                    <td class="duration-cell">{{ entry.durationSeconds | formatDuration }}</td>
                    <td class="pay-cell money-item">{{ entry.totalPay | money }}</td>
                    <td>
                      <span
                        class="badge"
                        [class.badge-synced]="entry.syncStatus === 'synced'"
                        [class.badge-pending]="entry.syncStatus !== 'synced'"
                      >
                        {{ entry.syncStatus === 'synced' ? 'Synced' : 'Waiting to sync' }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      @if (payslipFor(); as paid) {
        <app-payslip [payout]="paid" [entries]="myEntries()" [email]="authService.currentUser()?.email || ''" (closed)="payslipFor.set(null)" />
      }

      <!-- Change PIN Modal -->
      @if (showPinModal()) {
        <div class="modal-overlay" (click)="closePinModal()">
          <div class="modal-card" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title-group">
                <span class="modal-icon"><app-icon name="lock" [size]="18" /></span>
                <h3>Change Your PIN</h3>
              </div>
              <button type="button" class="modal-close" (click)="closePinModal()"><app-icon name="x" [size]="18" /></button>
            </div>

            <form (submit)="onSavePin($event)" class="modal-body">
              <p class="modal-desc">
                Update the PIN used for signing in as <strong>{{ authService.currentUser()?.name }}</strong>.
              </p>

              @if (authService.currentUser()?.pin) {
                <div class="form-group">
                  <label class="form-label">Current PIN</label>
                  <input
                    type="password"
                    class="form-input"
                    placeholder="Enter current PIN"
                    [(ngModel)]="currentPin"
                    name="currentPin"
                    autocomplete="current-password"
                    maxlength="10"
                  />
                </div>
              }

              <div class="form-group">
                <label class="form-label">New PIN (4-10 digits)</label>
                <input
                  type="password"
                  class="form-input"
                  placeholder="Enter new PIN"
                  [(ngModel)]="newPin"
                  name="newPin"
                  autocomplete="new-password"
                  maxlength="10"
                />
              </div>

              <div class="form-group">
                <label class="form-label">Confirm New PIN</label>
                <input
                  type="password"
                  class="form-input"
                  placeholder="Re-enter new PIN"
                  [(ngModel)]="confirmPin"
                  name="confirmPin"
                  autocomplete="new-password"
                  maxlength="10"
                />
              </div>

              @if (pinError()) {
                <div class="pin-alert error">
                  {{ pinError() }}
                </div>
              }

              @if (pinSuccess()) {
                <div class="pin-alert success">
                  {{ pinSuccess() }}
                </div>
              }

              <div class="modal-actions">
                <button type="button" class="btn-cancel" (click)="closePinModal()">Cancel</button>
                <button type="submit" class="btn-save-pin" [disabled]="savingPin()">
                  {{ savingPin() ? 'Updating...' : 'Update PIN' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .tracker-page {
      max-width: 960px;
      margin: 1.5rem auto;
      padding: 0 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .tracker-card {
      background: var(--av-surface);
      border-radius: 16px;
      border: 1px solid var(--av-border);
      padding: 1.75rem;
      box-shadow: 0 10px 25px -5px rgba(6, 60, 53, 0.1);
      color: var(--av-text);
    }
    .user-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid var(--av-border);
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .user-profile {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: white;
      font-size: 1rem;
    }
    .user-name {
      font-weight: 600;
      font-size: 1.05rem;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn-pin-pill {
      background: rgba(168, 124, 44, 0.12);
      border: 1px solid rgba(168, 124, 44, 0.3);
      color: var(--av-gold-soft);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-pin-pill:hover {
      background: rgba(168, 124, 44, 0.25);
      color: var(--av-forest);
      border-color: var(--av-gold);
    }
    .user-role-badge {
      font-size: 0.8rem;
      color: var(--av-text-muted);
    }
    .shift-status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .shift-status-pill.active {
      background: rgba(16, 185, 129, 0.2);
      color: var(--av-green-text);
      border: 1px solid var(--av-green);
    }
    .shift-status-pill.paused {
      background: rgba(245, 158, 11, 0.2);
      color: var(--av-amber-text);
      border: 1px solid #f59e0b;
    }
    .shift-status-pill.completed {
      background: var(--av-border);
      color: var(--av-text-muted);
      border: 1px solid var(--av-border-strong);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    .shift-status-pill.active .status-dot {
      box-shadow: 0 0 10px var(--av-green-text);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.3); }
    }
    .selection-grid {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 1.25rem;
      margin-bottom: 1.25rem;
    }
    @media (max-width: 640px) {
      .selection-grid {
        grid-template-columns: 1fr;
      }
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--av-text-body);
    }
    .form-select, .form-input {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 10px;
      padding: 10px 14px;
      color: var(--av-text);
      font-size: 0.95rem;
      outline: none;
      transition: border 0.15s ease;
    }
    .form-select:focus, .form-input:focus {
      border-color: var(--av-gold);
    }
    .form-select:disabled, .form-input:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .suggestions-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .suggest-label {
      font-size: 0.75rem;
      color: var(--av-text-faint);
    }
    .chip {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      color: var(--av-text-muted);
      border-radius: 9999px;
      padding: 4px 10px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .chip:hover {
      border-color: var(--av-gold);
      color: var(--av-gold-text);
    }
    .timer-display-wrap {
      text-align: center;
      padding: 2.25rem 1rem;
      background: var(--av-surface-2);
      border-radius: 14px;
      border: 1px solid var(--av-divider);
      margin-bottom: 1.5rem;
    }
    .timer-digits {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 4.5rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--av-text);
      line-height: 1;
      text-shadow: 0 4px 20px rgba(6, 60, 53, 0.14);
    }
    @media (max-width: 640px) {
      .timer-digits {
        font-size: 3rem;
      }
    }
    .session-sub-info {
      margin-top: 0.85rem;
      font-size: 0.92rem;
      color: var(--av-text-muted);
    }
    .earned-text {
      color: var(--av-green);
      font-size: 1.05rem;
    }
    .paused-text {
      color: var(--av-amber-text);
    }
    .idle-text {
      color: var(--av-text-faint);
      font-size: 0.85rem;
    }
    .actions-row {
      display: flex;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 28px;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 4px 12px rgba(6, 60, 53, 0.07);
    }
    .btn-clock-in {
      background: linear-gradient(135deg, var(--av-green), var(--av-green-hover));
      color: white;
    }
    .btn-clock-in:hover {
      background: linear-gradient(135deg, var(--av-green-hover), var(--av-green-deep));
      transform: translateY(-1px);
    }
    .btn-pause {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: white;
    }
    .btn-pause:hover {
      background: linear-gradient(135deg, #d97706, #b45309);
    }
    .btn-resume {
      background: linear-gradient(135deg, var(--av-green), var(--av-green-hover));
      color: white;
    }
    .btn-resume:hover {
      background: linear-gradient(135deg, var(--av-green-hover), var(--av-green-deep));
    }
    .btn-clock-out {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
    }
    .btn-clock-out:hover {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
    }
    .history-card {
      background: var(--av-surface);
      border-radius: 16px;
      border: 1px solid var(--av-border);
      padding: 1.5rem;
      color: var(--av-text);
    }
    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .history-title {
      font-size: 1.1rem;
      font-weight: 700;
      margin: 0;
    }
    .history-date {
      font-size: 0.8rem;
      color: var(--av-text-muted);
    }
    .history-totals {
      display: flex;
      gap: 1.5rem;
      background: var(--av-surface-2);
      padding: 8px 16px;
      border-radius: 10px;
      border: 1px solid var(--av-border);
    }
    .total-stat {
      display: flex;
      gap: 6px;
      font-size: 0.85rem;
      align-items: center;
    }
    .stat-label {
      color: var(--av-text-muted);
    }
    .stat-value {
      font-weight: 700;
    }
    .stat-value.highlight {
      color: var(--av-green);
    }
    .empty-history {
      text-align: center;
      padding: 2rem;
      color: var(--av-text-faint);
      font-size: 0.9rem;
    }
    .table-container {
      overflow-x: auto;
    }
    .shifts-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
      text-align: left;
    }
    .shifts-table th {
      padding: 10px 12px;
      color: var(--av-text-muted);
      border-bottom: 1px solid var(--av-border);
      font-weight: 600;
      font-size: 0.78rem;
      text-transform: uppercase;
    }
    .shifts-table td {
      padding: 12px;
      border-bottom: 1px solid var(--av-divider);
      color: var(--av-text-body);
    }
    .client-tag {
      background: var(--av-surface-2);
      padding: 4px 8px;
      border-radius: 6px;
      font-weight: 600;
      color: var(--av-gold-text);
      font-size: 0.8rem;
    }
    .task-cell {
      font-weight: 500;
      color: var(--av-text);
      max-width: 260px;
    }
    .duration-cell {
      font-family: monospace;
      font-weight: 600;
    }
    .pay-cell {
      font-weight: 700;
      color: var(--av-green);
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-synced {
      background: rgba(16, 185, 129, 0.15);
      color: var(--av-green-text);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-pending {
      background: rgba(245, 158, 11, 0.15);
      color: var(--av-amber-text);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(6, 60, 53, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 1rem;
    }
    .modal-card {
      background: var(--av-surface);
      border: 1px solid var(--av-border);
      border-radius: 16px;
      padding: 1.75rem;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(6, 60, 53, 0.18);
      color: var(--av-text);
      animation: modalPop 0.15s ease-out;
    }
    @keyframes modalPop {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--av-border);
      padding-bottom: 0.75rem;
    }
    .modal-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .modal-title-group h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
    }
    .modal-close {
      background: none;
      border: none;
      color: var(--av-text-muted);
      font-size: 1.25rem;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }
    .modal-close:hover {
      color: var(--av-text);
    }
    .modal-desc {
      font-size: 0.85rem;
      color: var(--av-text-muted);
      margin-bottom: 1.25rem;
      line-height: 1.4;
    }
    .modal-body {
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
    .form-input {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--av-text);
      font-size: 0.9rem;
      outline: none;
    }
    .form-input:focus {
      border-color: var(--av-gold);
    }
    .pin-alert {
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 500;
    }
    .pin-alert.error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--av-red-text);
    }
    .pin-alert.success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--av-green-text);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 0.5rem;
    }
    .btn-cancel {
      background: transparent;
      border: 1px solid var(--av-border);
      color: var(--av-text-muted);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .btn-cancel:hover {
      background: var(--av-border);
      color: var(--av-text);
    }
    .btn-save-pin {
      background: linear-gradient(135deg, var(--av-gold), var(--av-forest));
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(6, 60, 53, 0.3);
    }
    .btn-save-pin:hover:not(:disabled) {
      background: linear-gradient(135deg, var(--av-forest), var(--av-forest-hover));
    }
    .btn-save-pin:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    /* ── Premium layer ─────────────────────────────────────────────── */
    .tracker-page {
      max-width: 1400px;
      padding: 0 1.25rem;
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
      align-items: stretch;
      gap: 1.25rem;
    }
    .tracker-card { grid-column: 1; }
    .pay-card { grid-column: 2; }
    .history-card { grid-column: 1 / -1; }
    @media (max-width: 1000px) {
      .tracker-page { grid-template-columns: 1fr; }
      .tracker-card, .pay-card, .history-card { grid-column: 1; }
    }
    .tracker-card, .history-card, .pay-card {
      background: var(--av-surface);
      border: 1px solid var(--av-border);
      border-radius: 20px;
      box-shadow: 0 1px 2px rgba(6, 60, 53, 0.04), 0 18px 40px -24px rgba(6, 60, 53, 0.22);
    }
    .avatar {
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--av-surface), 0 0 0 3px var(--av-gold-soft);
    }
    .user-name { font-family: var(--av-font-heading); font-weight: 600; letter-spacing: -0.01em; }
    .shift-status-pill {
      font-size: 0.68rem;
      letter-spacing: 0.12em;
      font-weight: 600;
    }
    .form-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--av-text-muted);
    }
    .timer-display-wrap {
      background: linear-gradient(180deg, var(--av-surface-2), var(--av-surface));
      border: 1px solid var(--av-divider);
    }
    .timer-digits {
      font-family: var(--av-font-heading);
      font-weight: 300;
      font-size: 5rem;
      letter-spacing: 0.02em;
      font-variant-numeric: tabular-nums;
      text-shadow: none;
      color: var(--av-forest);
    }
    @media (max-width: 640px) { .timer-digits { font-size: 3.2rem; } }
    .btn {
      border-radius: 999px;
      letter-spacing: 0.02em;
      box-shadow: 0 10px 24px -14px rgba(6, 60, 53, 0.6);
    }
    .btn-clock-in, .btn-resume {
      background: var(--av-forest);
      color: var(--av-ivory);
    }
    .btn-clock-in:hover, .btn-resume:hover { background: var(--av-forest-hover); }
    .chip { border-radius: 999px; }
    .history-title, .pay-card-title {
      font-family: var(--av-font-heading);
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--av-forest);
    }
    .history-title-group { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .shifts-table th {
      font-size: 0.68rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--av-text-muted);
      font-weight: 600;
    }
    .date-td { white-space: nowrap; font-weight: 600; color: var(--av-forest); }
    /* Inside the admin area (My Timer page) the menu layout already adds spacing */
    :host-context(.admin-page) .tracker-page { margin: 0; padding: 0; max-width: none; }
    /* Team Access: hide money / pay panel when switched off */
    .no-money .money-item { display: none !important; }
    .slip-link {
      margin-left: 8px;
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--av-gold-text);
      text-decoration: underline;
      cursor: pointer;
    }
    .no-pay-panel .tracker-card { grid-column: 1 / -1; }
    .range-nav { display: inline-flex; align-items: center; gap: 8px; }
    .range-label { font-size: 0.85rem; font-weight: 600; color: var(--av-forest); }
    .step {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1px solid var(--av-border);
      background: var(--av-surface);
      color: var(--av-forest);
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
    }
    .step:disabled { opacity: 0.35; cursor: default; }
    .date-in {
      border: 1px solid var(--av-border-strong);
      border-radius: 10px;
      padding: 5px 8px;
      font-size: 0.8rem;
      color: var(--av-forest);
      background: var(--av-surface);
    }

    /* Segmented switch */
    .seg { display: inline-flex; border: 1px solid var(--av-border); border-radius: 999px; overflow: hidden; background: var(--av-surface-2); }
    .seg button { background: none; border: none; padding: 6px 14px; font-size: 0.78rem; color: var(--av-text-body); cursor: pointer; }
    .seg button.active { background: var(--av-forest); color: var(--av-ivory); }

    /* My pay period */
    .pay-card {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.1rem;
      position: relative;
      overflow: hidden;
    }
    .pay-card::before {
      content: '';
      position: absolute;
      inset: 0 0 auto 0;
      height: 3px;
      background: linear-gradient(90deg, var(--av-gold), var(--av-gold-soft), var(--av-gold));
    }
    .pay-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    .eyebrow {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--av-gold-text);
      font-weight: 600;
    }
    .pay-card-title { font-size: 1.25rem; margin-top: 4px; }
    .pay-status, .pay-mini {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--av-divider);
      color: var(--av-text-muted);
      white-space: nowrap;
    }
    .pay-mini { padding: 2px 8px; margin-left: 6px; font-size: 0.68rem; }
    [data-status='paid'], [data-status='approved'] { background: rgba(46, 125, 91, 0.12); color: var(--av-green-text); }
    [data-status='submitted'] { background: rgba(168, 124, 44, 0.14); color: var(--av-gold-text); }
    [data-status='rejected'] { background: rgba(239, 68, 68, 0.1); color: var(--av-red-text); }
    .pay-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 1.25rem; }
    .pay-stat { display: flex; flex-direction: column; gap: 4px; }
    .pay-stat:last-child { grid-column: 1 / -1; padding-top: 1rem; border-top: 1px solid var(--av-divider); }
    .pay-stat.week {
      grid-column: 1 / -1;
      padding: 0.85rem 1rem;
      background: var(--av-surface-2);
      border: 1px solid var(--av-divider);
      border-radius: 14px;
    }
    .week-earn { margin-left: auto; font-size: 1.25rem; color: var(--av-gold-text); }
    .pay-stat-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--av-text-muted); }
    .pay-stat-value {
      font-family: var(--av-font-heading);
      font-size: 1.9rem;
      font-weight: 600;
      color: var(--av-forest);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
    .pay-stat-value.gold { color: var(--av-gold-text); }
    .pay-stat-value.small { font-size: 1.1rem; display: flex; align-items: center; flex-wrap: wrap; }
    .pay-actions { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
    .btn-submit-ts {
      border: none;
      background: var(--av-forest);
      color: var(--av-ivory);
      padding: 10px 16px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-submit-ts:hover { background: var(--av-forest-hover); }
    .btn-submit-ts.outline { background: none; color: var(--av-forest); border: 1px solid var(--av-border-strong); }
    .btn-submit-ts.outline:hover { border-color: var(--av-gold); }
    .btn-pause {
      background: var(--av-surface);
      color: var(--av-gold-text);
      border: 1px solid var(--av-gold-soft);
      box-shadow: none;
    }
    .btn-pause:hover { background: var(--av-surface-2); border-color: var(--av-gold); }
    .btn-clock-out {
      background: #7a2a2a;
      color: var(--av-ivory);
    }
    .btn-clock-out:hover { background: #8f3232; }
    .sent-back {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      font-size: 0.82rem;
      color: var(--av-red-text);
      background: rgba(239, 68, 68, 0.07);
      border: 1px solid rgba(239, 68, 68, 0.2);
      padding: 10px 12px;
      border-radius: 12px;
    }
  `],
})
export class UserTrackerComponent implements OnInit {
  clients = signal<Client[]>([]);
  selectedClientId = signal<string>('');
  taskDescription = signal<string>('');

  // PIN modal state
  showPinModal = signal<boolean>(false);
  currentPin = '';
  newPin = '';
  confirmPin = '';
  pinError = signal<string | null>(null);
  pinSuccess = signal<string | null>(null);
  savingPin = signal<boolean>(false);

  historyView = signal<'today' | 'week' | 'period' | 'custom'>('today');
  weekOffset = signal<number>(0); // 0 = this week, -1 = last week, ...
  customFrom = signal<string>('');
  customTo = signal<string>('');
  myEntries = signal<TimeEntry[]>([]);
  myPayouts = signal<Payout[]>([]);
  myApprovals = signal<TimesheetApproval[]>([]);
  payslipFor = signal<Payout | null>(null);
  /** Team Access settings for me (admins always get everything) */
  perms = signal<MemberPermissions>(DEFAULT_MEMBER_PERMISSIONS);

  readonly currentPeriod = payPeriodFor(new Date());
  readonly lastPeriod = previousPayPeriod(new Date());
  readonly currentPeriodLabel = formatPeriod(...this.currentPeriod);
  /** Monday–Sunday of the current week */
  readonly thisWeek: [Date, Date] = (() => {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return [monday, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)] as [Date, Date];
  })();
  readonly weekLabel = formatPeriod(...this.thisWeek);
  readonly lastPeriodLabel = formatPeriod(...this.lastPeriod);

  constructor(
    private offlineStorage: OfflineStorageService,
    public timerService: TimerService,
    public authService: AuthService
  ) {
    // Refresh my pay-period numbers whenever today's entries change (clock in/out)
    effect(() => {
      this.timerService.todayEntries();
      this.loadMyHistory();
    });
  }

  async loadMyHistory(): Promise<void> {
    const me = this.authService.currentUser();
    if (!me) return;
    const [entries, payouts, approvals] = await Promise.all([
      this.offlineStorage.getTimeEntries(),
      this.offlineStorage.getPayouts(),
      this.offlineStorage.getApprovals(),
    ]);
    this.myEntries.set(entries.filter((e) => e.employeeId === me.id));
    this.myPayouts.set(payouts.filter((p) => p.employeeId === me.id));
    this.myApprovals.set(approvals.filter((a) => a.employeeId === me.id));
    this.perms.set(effectivePermissions(await this.offlineStorage.getPermissions(), me));
    if (!this.perms().viewHistory) this.historyView.set('today');
  }

  private inPeriod(e: TimeEntry, [start, end]: [Date, Date]): boolean {
    return e.startTime >= start.getTime() && e.startTime < end.getTime() + 24 * 60 * 60 * 1000;
  }

  periodSeconds(period: [Date, Date]): number {
    return this.myEntries().filter((e) => this.inPeriod(e, period)).reduce((acc, e) => acc + e.durationSeconds, 0);
  }

  periodPay(period: [Date, Date]): number {
    return this.myEntries().filter((e) => this.inPeriod(e, period)).reduce((acc, e) => acc + (e.totalPay || 0), 0);
  }

  private payoutFor([start, end]: [Date, Date]): Payout | null {
    return this.myPayouts().find((p) => p.periodStart === start.getTime() && p.periodEnd === end.getTime()) || null;
  }

  currentPayout(): Payout | null {
    return this.payoutFor(this.currentPeriod);
  }

  lastPayout(): Payout | null {
    return this.payoutFor(this.lastPeriod);
  }

  approvalFor([start]: [Date, Date]): TimesheetApproval | null {
    return this.myApprovals().find((a) => a.periodStart === start.getTime()) || null;
  }

  /** paid > approved > submitted > rejected > open */
  periodStatus(period: [Date, Date]): 'paid' | 'approved' | 'submitted' | 'rejected' | 'open' {
    if (this.payoutFor(period)) return 'paid';
    return this.approvalFor(period)?.status ?? 'open';
  }

  statusLabel(status: ReturnType<UserTrackerComponent['periodStatus']>): string {
    return { paid: 'Paid', approved: 'Approved', submitted: 'Submitted', rejected: 'Sent back', open: 'Not submitted' }[status];
  }

  canSubmit(period: [Date, Date]): boolean {
    const status = this.periodStatus(period);
    return (status === 'open' || status === 'rejected') && this.periodSeconds(period) > 0;
  }

  async submitTimesheet(period: [Date, Date]): Promise<void> {
    const me = this.authService.currentUser();
    if (!me) return;
    const hours = this.periodSeconds(period) / 3600;
    const ok = confirm(`Submit your timesheet for ${formatPeriod(...period)} (${hours.toFixed(2)} hours)?`);
    if (!ok) return;
    await this.offlineStorage.saveApproval({
      id: `${me.id}_${period[0].getTime()}`,
      employeeId: me.id,
      employeeName: me.name,
      periodStart: period[0].getTime(),
      periodEnd: period[1].getTime(),
      status: 'submitted',
      hours: parseFloat(hours.toFixed(2)),
      submittedAt: Date.now(),
    });
    await this.loadMyHistory();
  }

  /** Dates for the "My Time" table (null = today, which uses the live list). */
  historyRange(): [Date, Date] | null {
    switch (this.historyView()) {
      case 'week': {
        const [mon] = this.thisWeek;
        const start = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7 * this.weekOffset());
        return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)];
      }
      case 'period':
        return this.currentPeriod;
      case 'custom': {
        const from = this.parseDate(this.customFrom());
        const to = this.parseDate(this.customTo());
        return from && to && to >= from ? [from, to] : null;
      }
      default:
        return null;
    }
  }

  historyRangeLabel(): string {
    const r = this.historyRange();
    return r ? formatPeriod(...r) : '';
  }

  private parseDate(value: string): Date | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  }

  formatDay(ms: number): string {
    return new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  openPinModal(): void {
    this.currentPin = '';
    this.newPin = '';
    this.confirmPin = '';
    this.pinError.set(null);
    this.pinSuccess.set(null);
    this.showPinModal.set(true);
  }

  closePinModal(): void {
    this.showPinModal.set(false);
  }

  async onSavePin(event: Event): Promise<void> {
    event.preventDefault();
    this.pinError.set(null);
    this.pinSuccess.set(null);

    const cleanNew = this.newPin.trim();
    if (!cleanNew) {
      this.pinError.set('Please enter a new PIN.');
      return;
    }

    if (cleanNew.length < 4) {
      this.pinError.set('PIN must be at least 4 digits.');
      return;
    }

    if (cleanNew !== this.confirmPin.trim()) {
      this.pinError.set('New PIN and Confirm PIN do not match.');
      return;
    }

    this.savingPin.set(true);
    const res = await this.authService.changeCurrentUserPin(cleanNew, this.currentPin);
    this.savingPin.set(false);

    if (res.success) {
      this.pinSuccess.set(res.message);
      setTimeout(() => {
        this.closePinModal();
      }, 1500);
    } else {
      this.pinError.set(res.message);
    }
  }

  async ngOnInit(): Promise<void> {
    const me = this.authService.currentUser();
    if (me) await this.timerService.restoreActiveSession(me.id);
    await this.loadClients();
  }

  async loadClients(): Promise<void> {
    const [all, contracts] = await Promise.all([this.offlineStorage.getClients(), this.offlineStorage.getContracts()]);
    // Like WebWork: members only see projects they have a contract on (admins, or members with no contracts, see all)
    const me = this.authService.currentUser();
    const mine = new Set(contracts.filter((c) => c.active && c.employeeId === me?.id).map((c) => c.clientId));
    const allowAll = effectivePermissions(await this.offlineStorage.getPermissions(), me).allProjects;
    const list = allowAll || mine.size === 0 ? all : all.filter((c) => mine.has(c.id));
    this.clients.set(list);
    if (list.length > 0 && !list.some((c) => c.id === this.selectedClientId())) {
      this.selectedClientId.set(list[0].id);
    }
  }

  getInitials(name?: string): string {
    if (!name) return 'U';
    return name
      .replace(/\([^)]*\)/g, '')
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  calculateEarned(elapsedSec: number): number {
    // Use the rate saved on the running entry (contract rate for that client)
    const rate = this.timerService.activeEntry()?.hourlyRate ?? this.authService.currentUser()?.hourlyRate ?? 0;
    return (elapsedSec / 3600) * rate;
  }

  async onClockInClick(): Promise<void> {
    const emp = this.authService.currentUser();
    const cli = this.clients().find((c) => c.id === this.selectedClientId()) || this.clients()[0];

    if (!emp || !cli) return;

    await this.timerService.clockIn(emp, cli, this.taskDescription());
  }

  async onClockOutClick(): Promise<void> {
    await this.timerService.clockOut();
  }

  formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** Rows for the "My Time" table: today, or the whole current pay period. */
  myShiftsToday(): TimeEntry[] {
    const emp = this.authService.currentUser();
    if (!emp) return [];
    const range = this.historyRange();
    if (range) {
      return this.myEntries()
        .filter((e) => this.inPeriod(e, range))
        .sort((a, b) => b.startTime - a.startTime);
    }
    if (this.historyView() === 'custom') return [];
    return this.timerService.todayEntries().filter((e) => e.employeeId === emp.id);
  }

  calculateUserTodaySeconds(): number {
    return this.myShiftsToday().reduce((acc, curr) => acc + curr.durationSeconds, 0);
  }

  calculateUserTodayEarnings(): number {
    const sum = this.myShiftsToday().reduce((acc, curr) => acc + (curr.totalPay || 0), 0);
    return sum;
  }
}
