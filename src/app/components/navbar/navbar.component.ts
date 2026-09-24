import { Component, effect, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { SupabaseSyncService, SyncResult } from '../../services/google-sync.service';
import { UserRole } from '../../models/time-tracker.models';
import { IconComponent } from '../icon/icon.component';
import { TimerService } from '../../services/timer.service';
import { NavService } from '../../services/nav.service';
import { FormatDurationPipe } from '../../pipes/format-duration.pipe';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, FormatDurationPipe],
  template: `
    <header class="navbar-container">
      <div class="navbar-left">
        <div class="brand">
          <img class="brand-logo" src="auravia-mark.png" alt="Auravia Collective" />
          <div class="brand-text">
            <span class="brand-name">Auravia Collective</span>
            <span class="brand-tag">Time Tracker</span>
          </div>
        </div>

        <!-- Role View Switcher (Removed as per user request to merge views) -->
      </div>

      <div class="navbar-right">
        <!-- Running timer: visible on every page; admins can click it to open My Timer -->
        @if (timerService.status() !== 'completed') {
          <button type="button" class="live-timer" [class.paused]="timerService.status() === 'paused'" (click)="nav.open('tracker')"
            [title]="authService.isAdmin() ? 'Open My Timer' : ''">
            <span class="live-dot"></span>
            <span class="live-time">{{ timerService.elapsedSeconds() | formatDuration }}</span>
            <span class="live-client">{{ timerService.activeEntry()?.clientName }}</span>
          </button>
        }
        <!-- Locked Active User Profile Strip -->
        <div class="user-locked-badge">
          <div class="user-avatar" [style.background]="authService.currentUser()?.avatarColor || '#a87c2c'">
            {{ getInitials(authService.currentUser()?.name) }}
          </div>
          <div class="user-details">
            <span class="user-display-name">{{ authService.currentUser()?.name }}</span>
            <span class="user-display-sub">
              @if (authService.isAdmin()) {
                <span class="admin-label">Administrator</span>
              } @else {
                <span class="rate-label">{{ authService.currentUser()?.department || 'Team member' }}</span>
              }
            </span>
          </div>
        </div>

        <!-- Online / Offline Badge -->
        <div class="status-pill" [class.online]="supabaseSync.isOnline()" [class.offline]="!supabaseSync.isOnline()">
          <span class="dot"></span>
          <span>{{ supabaseSync.isOnline() ? 'Online' : 'Offline' }}</span>
        </div>

        <!-- Sync Button & Pending Counter -->
        <div class="sync-group">
          @if (supabaseSync.pendingEntriesCount() > 0 || supabaseSync.pendingScreenshotsCount() > 0) {
            <span class="pending-badge" title="Pending sync items in local storage">
              {{ supabaseSync.pendingEntriesCount() }} logs • {{ supabaseSync.pendingScreenshotsCount() }} imgs
            </span>
          }

          <button
            type="button"
            class="sync-btn"
            [disabled]="supabaseSync.isSyncing()"
            (click)="onSyncClick()"
            title="Sync offline records with Supabase"
          >
            <svg
              class="sync-icon"
              [class.spinning]="supabaseSync.isSyncing()"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              stroke="currentColor"
              stroke-width="2.2"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>{{ supabaseSync.isSyncing() ? 'Syncing...' : 'Sync to Cloud' }}</span>
          </button>
        </div>

        <!-- Change PIN Button -->
        <button
          type="button"
          class="btn-pin"
          (click)="openChangePinModal()"
          title="Change login PIN code"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none">
            <path d="M21 2l-2 2m-1.5 1.5L10 13l-4-1-3 3 1.5 1.5L2 19l3 3 2.5-2.5L9 21l3-3-1-4 7.5-7.5m1.5-1.5L22 4l-2-2"></path>
            <circle cx="16.5" cy="7.5" r="1.5"></circle>
          </svg>
          <span>Change PIN</span>
        </button>

        <!-- Log Out Button -->
        <button type="button" class="btn-logout" (click)="onLogout()" title="Log out of session">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          <span>Log Out</span>
        </button>
      </div>
    </header>

    <!-- Change PIN Modal -->
    @if (showPinModal()) {
      <div class="modal-overlay" (click)="!authService.mustChangePin() && closePinModal()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-icon"><app-icon name="lock" [size]="18" /></span>
              <h3>{{ authService.mustChangePin() ? 'Welcome! Choose your own PIN' : 'Change Your PIN' }}</h3>
            </div>
            @if (!authService.mustChangePin()) {
              <button type="button" class="modal-close" (click)="closePinModal()"><app-icon name="x" [size]="18" /></button>
            }
          </div>

          <form (submit)="onSavePin($event)" class="modal-body">
            @if (authService.mustChangePin()) {
              <p class="modal-desc">
                You signed in with your starting PIN. To keep your account safe, please pick your own PIN now.
                <br /><strong>Current PIN:</strong> your starting PIN · <strong>New PIN:</strong> anything else only you know (at least 4 characters).
              </p>
            }
            <p class="modal-desc">
              Change the PIN used for signing in as <strong>{{ authService.currentUser()?.name }}</strong> ({{ authService.isAdmin() ? 'Administrator' : 'Normal User' }}).
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
                  maxlength="20"
                />
              </div>
            }

            <div class="form-group">
              <label class="form-label">New PIN (at least 4 characters)</label>
              <input
                type="password"
                class="form-input"
                [placeholder]="authService.mustChangePin() ? 'Not your starting PIN' : 'Enter new PIN'"
                [(ngModel)]="newPin"
                name="newPin"
                autocomplete="new-password"
                maxlength="20"
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
                maxlength="20"
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
              @if (!authService.mustChangePin()) {
                <button type="button" class="btn-cancel" (click)="closePinModal()">Cancel</button>
              }
              <button type="submit" class="btn-save-pin" [disabled]="savingPin()">
                {{ savingPin() ? 'Updating...' : 'Update PIN' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    }

    @if (syncNotification()) {
      <div class="sync-toast" [class.success]="syncNotification()?.success" [class.error]="!syncNotification()?.success">
        <span>{{ syncNotification()?.message }}</span>
        <button class="toast-close" (click)="syncNotification.set(null)"><app-icon name="x" [size]="16" /></button>
      </div>
    }
  `,
  styles: [`
    .navbar-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1.5rem;
      background: var(--av-surface-2);
      border-bottom: 1px solid var(--av-divider);
      color: var(--av-text);
      gap: 1rem;
      flex-wrap: wrap;
    }
    .navbar-left {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    .brand-logo {
      width: 42px;
      height: 42px;
      object-fit: contain;
      display: block;
    }
    .brand-name {
      font-family: var(--av-font-heading);
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .brand-tag {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: rgba(168, 124, 44, 0.12);
      color: var(--av-gold-text);
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 6px;
      font-weight: 600;
    }
    .navbar-right {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .user-locked-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--av-surface);
      padding: 4px 12px 4px 6px;
      border-radius: 10px;
      border: 1px solid var(--av-border);
    }
    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      font-weight: 700;
      color: white;
    }
    .user-details {
      display: flex;
      flex-direction: column;
    }
    .user-display-name {
      font-size: 0.85rem;
      font-weight: 600;
      line-height: 1.1;
      color: var(--av-text);
    }
    .user-display-sub {
      font-size: 0.72rem;
      color: var(--av-text-muted);
    }
    .admin-label {
      color: var(--av-gold);
      font-weight: 600;
    }
    .rate-label {
      color: var(--av-green-text);
      font-weight: 600;
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .status-pill.online {
      background: rgba(16, 185, 129, 0.15);
      color: var(--av-green-text);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-pill.offline {
      background: rgba(239, 68, 68, 0.15);
      color: var(--av-red-text);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .status-pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .status-pill.online .dot {
      background: var(--av-green);
      box-shadow: 0 0 8px var(--av-green);
    }
    .status-pill.offline .dot {
      background: #ef4444;
      box-shadow: 0 0 8px #ef4444;
    }
    .sync-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pending-badge {
      font-size: 0.75rem;
      background: #f59e0b;
      color: var(--av-forest);
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
    }
    .sync-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: var(--av-green-hover);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .sync-btn:hover:not(:disabled) {
      background: var(--av-green-deep);
    }
    .sync-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .sync-icon.spinning {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
    .btn-logout {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      color: var(--av-text-muted);
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-logout:hover {
      color: var(--av-red-text);
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.1);
    }
    .sync-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 18px;
      border-radius: 8px;
      color: white;
      font-size: 0.88rem;
      box-shadow: 0 8px 24px rgba(6, 60, 53, 0.14);
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 420px;
      animation: slideIn 0.2s ease-out;
    }
    .sync-toast.success {
      background: var(--av-green-deep);
      border: 1px solid var(--av-green);
    }
    .sync-toast.error {
      background: #7f1d1d;
      border: 1px solid #ef4444;
    }
    .toast-close {
      background: none;
      border: none;
      color: white;
      font-size: 1rem;
      cursor: pointer;
    }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .btn-pin {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: var(--av-surface);
      border: 1px solid var(--av-border);
      color: var(--av-gold-soft);
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-pin:hover {
      background: rgba(168, 124, 44, 0.15);
      border-color: var(--av-gold);
      color: var(--av-gold-soft);
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
    .navbar-container {
      background: rgba(254, 250, 241, 0.92);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--av-border);
      box-shadow: 0 1px 0 rgba(168, 124, 44, 0.18);
      padding: 0.7rem 2rem;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand-name {
      font-family: var(--av-font-heading);
      font-size: 0.95rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--av-forest);
    }
    .brand-tag {
      background: none;
      border-left: 1px solid var(--av-gold-soft);
      border-radius: 0;
      padding: 0 0 0 10px;
      margin-left: 10px;
      letter-spacing: 0.16em;
      font-size: 0.62rem;
      color: var(--av-gold-text);
    }
    .user-avatar { border-radius: 50%; }
    .live-timer {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(46, 125, 91, 0.35);
      background: rgba(46, 125, 91, 0.08);
      color: var(--av-forest);
      border-radius: 999px;
      padding: 6px 14px;
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .live-timer.paused { border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.08); }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--av-green); animation: livePulse 1.6s ease-in-out infinite; }
    .live-timer.paused .live-dot { background: #d97706; animation: none; }
    .live-time { font-weight: 700; font-variant-numeric: tabular-nums; }
    .live-client { color: var(--av-text-muted); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @keyframes livePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    .sync-btn, .btn-pin, .btn-logout { border-radius: 999px; }
  `],
})
export class NavbarComponent {
  readonly roleChange = output<UserRole>();
  readonly logoutEvent = output<void>();

  activeRole = signal<UserRole>('user');
  syncNotification = signal<SyncResult | null>(null);

  // PIN modal state
  showPinModal = signal<boolean>(false);
  currentPin = '';
  newPin = '';
  confirmPin = '';
  pinError = signal<string | null>(null);
  pinSuccess = signal<string | null>(null);
  savingPin = signal<boolean>(false);

  constructor(
    public authService: AuthService,
    public supabaseSync: SupabaseSyncService,
    public timerService: TimerService,
    public nav: NavService
  ) {
    // First sign-in with the starting PIN: open "choose your own PIN" and don't let it be skipped
    effect(() => {
      if (this.authService.mustChangePin() && !this.showPinModal()) {
        untracked(() => this.openChangePinModal());
      }
    });
    if (this.authService.isAdmin()) {
      this.activeRole.set('admin');
    } else {
      this.activeRole.set('user');
    }
  }

  openChangePinModal(): void {
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

  setRole(role: UserRole): void {
    if (!this.authService.isAdmin() && role === 'admin') {
      return;
    }
    this.activeRole.set(role);
    this.roleChange.emit(role);
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

  async onSyncClick(): Promise<void> {
    const result = await this.supabaseSync.syncNow();
    this.syncNotification.set(result);
    setTimeout(() => {
      if (this.syncNotification() === result) {
        this.syncNotification.set(null);
      }
    }, 5000);
  }

  onLogout(): void {
    this.authService.logout();
    this.logoutEvent.emit();
  }
}
