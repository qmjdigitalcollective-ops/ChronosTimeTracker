import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { TimerService } from '../../services/timer.service';
import { AuthService } from '../../services/auth.service';
import { FormatDurationPipe } from '../../pipes/format-duration.pipe';
import { Client } from '../../models/time-tracker.models';

@Component({
  selector: 'app-user-tracker',
  standalone: true,
  imports: [CommonModule, FormsModule, FormatDurationPipe],
  template: `
    <div class="tracker-page">
      <!-- Main Tracking Card -->
      <div class="tracker-card">
        <!-- User Info Strip (Locked to Logged In User) -->
        <div class="user-strip">
          <div class="user-profile">
            <div class="avatar" [style.background]="authService.currentUser()?.avatarColor || '#3b82f6'">
              {{ getInitials(authService.currentUser()?.name) }}
            </div>
            <div>
              <div class="user-name">
                <span>{{ authService.currentUser()?.name }}</span>
                <button
                  type="button"
                  class="btn-pin-pill"
                  (click)="openPinModal()"
                  title="Change your PIN"
                >
                  🔑 Change PIN
                </button>
              </div>
              <div class="user-role-badge">
                Rate: <strong>\${{ authService.currentUser()?.hourlyRate || 0 }}/hr</strong> • {{ authService.currentUser()?.department || 'Staff' }}
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
              Select Client
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
              placeholder="e.g. Implementing responsive dashboard UI, fixing login bug..."
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
            <button type="button" class="chip" (click)="taskDescription.set('Core Feature Implementation')">Core Features</button>
            <button type="button" class="chip" (click)="taskDescription.set('UI/UX Design & Styling')">UI Design</button>
            <button type="button" class="chip" (click)="taskDescription.set('Bug Investigation & Fixes')">Bug Fixes</button>
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
              <span>
                Earned this session:
                <strong class="earned-text">
                  \${{ calculateEarned(timerService.elapsedSeconds()) }}
                </strong>
              </span>
              @if (timerService.pausedSeconds() > 0) {
                <span class="paused-text">
                  • Paused: {{ timerService.pausedSeconds() | formatDuration }}
                </span>
              }
            } @else {
              <span class="idle-text">Select your client and task, then click Clock In to begin tracking</span>
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
              <span>Clock In & Start Tracking</span>
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
              <span>Time Out (Clock Out)</span>
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
              <span>Time Out (Clock Out)</span>
            </button>
          }
        </div>
      </div>

      <!-- Today's Work Summary (Only for the logged in user) -->
      <div class="history-card">
        <div class="history-header">
          <div class="history-title-group">
            <h3 class="history-title">My Shifts Today</h3>
            <span class="history-date">{{ todayFormatted }}</span>
          </div>

          <div class="history-totals">
            <div class="total-stat">
              <span class="stat-label">Total Time Today:</span>
              <span class="stat-value">{{ calculateUserTodaySeconds() | formatDuration }}</span>
            </div>
            <div class="total-stat">
              <span class="stat-label">Today's Earnings:</span>
              <span class="stat-value highlight">\${{ calculateUserTodayEarnings() }}</span>
            </div>
          </div>
        </div>

        @if (myShiftsToday().length === 0) {
          <div class="empty-history">
            No completed shifts recorded for you today yet. Clock in above to start your shift!
          </div>
        } @else {
          <div class="table-container">
            <table class="shifts-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Task Description</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Duration</th>
                  <th>Earnings</th>
                  <th>Sync Status</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of myShiftsToday(); track entry.id) {
                  <tr>
                    <td>
                      <span class="client-tag">{{ entry.clientName }}</span>
                    </td>
                    <td class="task-cell">{{ entry.taskDescription }}</td>
                    <td>{{ formatTime(entry.startTime) }}</td>
                    <td>{{ entry.endTime ? formatTime(entry.endTime) : 'In Progress' }}</td>
                    <td class="duration-cell">{{ entry.durationSeconds | formatDuration }}</td>
                    <td class="pay-cell">\${{ entry.totalPay | number:'1.2-2' }}</td>
                    <td>
                      <span
                        class="badge"
                        [class.badge-synced]="entry.syncStatus === 'synced'"
                        [class.badge-pending]="entry.syncStatus !== 'synced'"
                      >
                        {{ entry.syncStatus === 'synced' ? 'Synced to Sheets' : 'Offline Pending' }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Change PIN Modal -->
      @if (showPinModal()) {
        <div class="modal-overlay" (click)="closePinModal()">
          <div class="modal-card" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title-group">
                <span class="modal-icon">🔐</span>
                <h3>Change Your PIN</h3>
              </div>
              <button type="button" class="modal-close" (click)="closePinModal()">✕</button>
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
                  ⚠️ {{ pinError() }}
                </div>
              }

              @if (pinSuccess()) {
                <div class="pin-alert success">
                  ✓ {{ pinSuccess() }}
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
      background: #1e293b;
      border-radius: 16px;
      border: 1px solid #334155;
      padding: 1.75rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      color: #f8fafc;
    }
    .user-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid #334155;
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
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #93c5fd;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-pin-pill:hover {
      background: rgba(59, 130, 246, 0.25);
      color: #ffffff;
      border-color: #3b82f6;
    }
    .user-role-badge {
      font-size: 0.8rem;
      color: #94a3b8;
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
      color: #34d399;
      border: 1px solid #10b981;
    }
    .shift-status-pill.paused {
      background: rgba(245, 158, 11, 0.2);
      color: #fbbf24;
      border: 1px solid #f59e0b;
    }
    .shift-status-pill.completed {
      background: #334155;
      color: #94a3b8;
      border: 1px solid #475569;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    .shift-status-pill.active .status-dot {
      box-shadow: 0 0 10px #34d399;
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
      color: #cbd5e1;
    }
    .form-select, .form-input {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 14px;
      color: #f8fafc;
      font-size: 0.95rem;
      outline: none;
      transition: border 0.15s ease;
    }
    .form-select:focus, .form-input:focus {
      border-color: #3b82f6;
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
      color: #64748b;
    }
    .chip {
      background: #0f172a;
      border: 1px solid #334155;
      color: #94a3b8;
      border-radius: 9999px;
      padding: 4px 10px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .chip:hover {
      border-color: #3b82f6;
      color: #38bdf8;
    }
    .timer-display-wrap {
      text-align: center;
      padding: 2.25rem 1rem;
      background: #0f172a;
      border-radius: 14px;
      border: 1px solid #1e293b;
      margin-bottom: 1.5rem;
    }
    .timer-digits {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 4.5rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: #f8fafc;
      line-height: 1;
      text-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    @media (max-width: 640px) {
      .timer-digits {
        font-size: 3rem;
      }
    }
    .session-sub-info {
      margin-top: 0.85rem;
      font-size: 0.92rem;
      color: #94a3b8;
    }
    .earned-text {
      color: #10b981;
      font-size: 1.05rem;
    }
    .paused-text {
      color: #fbbf24;
    }
    .idle-text {
      color: #64748b;
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
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .btn-clock-in {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
    }
    .btn-clock-in:hover {
      background: linear-gradient(135deg, #059669, #047857);
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
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
    }
    .btn-resume:hover {
      background: linear-gradient(135deg, #059669, #047857);
    }
    .btn-clock-out {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
    }
    .btn-clock-out:hover {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
    }
    .history-card {
      background: #1e293b;
      border-radius: 16px;
      border: 1px solid #334155;
      padding: 1.5rem;
      color: #f8fafc;
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
      color: #94a3b8;
    }
    .history-totals {
      display: flex;
      gap: 1.5rem;
      background: #0f172a;
      padding: 8px 16px;
      border-radius: 10px;
      border: 1px solid #334155;
    }
    .total-stat {
      display: flex;
      gap: 6px;
      font-size: 0.85rem;
      align-items: center;
    }
    .stat-label {
      color: #94a3b8;
    }
    .stat-value {
      font-weight: 700;
    }
    .stat-value.highlight {
      color: #10b981;
    }
    .empty-history {
      text-align: center;
      padding: 2rem;
      color: #64748b;
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
      color: #94a3b8;
      border-bottom: 1px solid #334155;
      font-weight: 600;
      font-size: 0.78rem;
      text-transform: uppercase;
    }
    .shifts-table td {
      padding: 12px;
      border-bottom: 1px solid #1e293b;
      color: #cbd5e1;
    }
    .client-tag {
      background: #0f172a;
      padding: 4px 8px;
      border-radius: 6px;
      font-weight: 600;
      color: #38bdf8;
      font-size: 0.8rem;
    }
    .task-cell {
      font-weight: 500;
      color: #f8fafc;
      max-width: 260px;
    }
    .duration-cell {
      font-family: monospace;
      font-weight: 600;
    }
    .pay-cell {
      font-weight: 700;
      color: #10b981;
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
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-pending {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 1rem;
    }
    .modal-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 1.75rem;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      color: #f8fafc;
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
      border-bottom: 1px solid #334155;
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
      color: #94a3b8;
      font-size: 1.25rem;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }
    .modal-close:hover {
      color: #f8fafc;
    }
    .modal-desc {
      font-size: 0.85rem;
      color: #94a3b8;
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
      color: #cbd5e1;
    }
    .form-input {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 12px;
      color: #f8fafc;
      font-size: 0.9rem;
      outline: none;
    }
    .form-input:focus {
      border-color: #3b82f6;
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
      color: #f87171;
    }
    .pin-alert.success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 0.5rem;
    }
    .btn-cancel {
      background: transparent;
      border: 1px solid #334155;
      color: #94a3b8;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .btn-cancel:hover {
      background: #334155;
      color: #f8fafc;
    }
    .btn-save-pin {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
    }
    .btn-save-pin:hover:not(:disabled) {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
    }
    .btn-save-pin:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `],
})
export class UserTrackerComponent implements OnInit {
  clients = signal<Client[]>([]);
  selectedClientId = signal<string>('cli-1');
  taskDescription = signal<string>('Feature Implementation & Testing');

  // PIN modal state
  showPinModal = signal<boolean>(false);
  currentPin = '';
  newPin = '';
  confirmPin = '';
  pinError = signal<string | null>(null);
  pinSuccess = signal<string | null>(null);
  savingPin = signal<boolean>(false);

  todayFormatted = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  constructor(
    private offlineStorage: OfflineStorageService,
    public timerService: TimerService,
    public authService: AuthService
  ) {}

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
    await this.loadClients();
  }

  async loadClients(): Promise<void> {
    const list = await this.offlineStorage.getClients();
    this.clients.set(list);
    if (list.length > 0 && !this.selectedClientId()) {
      this.selectedClientId.set(list[0].id);
    }
  }

  getInitials(name?: string): string {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  calculateEarned(elapsedSec: number): string {
    const rate = this.authService.currentUser()?.hourlyRate || 0;
    return ((elapsedSec / 3600) * rate).toFixed(2);
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

  myShiftsToday() {
    const emp = this.authService.currentUser();
    if (!emp) return [];
    return this.timerService.todayEntries().filter((e) => e.employeeId === emp.id);
  }

  calculateUserTodaySeconds(): number {
    return this.myShiftsToday().reduce((acc, curr) => acc + curr.durationSeconds, 0);
  }

  calculateUserTodayEarnings(): string {
    const sum = this.myShiftsToday().reduce((acc, curr) => acc + (curr.totalPay || 0), 0);
    return sum.toFixed(2);
  }
}
