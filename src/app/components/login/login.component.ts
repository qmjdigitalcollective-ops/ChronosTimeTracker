import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <!-- Logo & Branding -->
        <div class="login-header">
          <img class="brand-logo" src="auravia-mark.png" alt="Auravia Collective" />
          <h2 class="brand-title">Auravia Collective</h2>
          <p class="brand-desc">Team Time Tracker</p>
        </div>

        <!-- Login Form -->
        <form class="login-form" (submit)="onSubmit($event)">
          <div class="form-group">
            <label class="form-label" for="username-input">Email or Employee ID</label>
            <input
              id="username-input"
              type="text"
              class="form-input"
              placeholder="you@email.com or emp-1"
              [(ngModel)]="username"
              name="username"
              autocomplete="username"
              autofocus
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="pin-input">PIN Code</label>
            <input
              id="pin-input"
              type="password"
              class="form-input"
              placeholder="Enter your PIN"
              [(ngModel)]="pin"
              name="pin"
              autocomplete="current-password"
              maxlength="20"
            />
          </div>

          @if (errorMessage()) {
            <div class="error-banner">
              {{ errorMessage() }}
            </div>
          }

          <button type="submit" class="btn-submit" [disabled]="loading()">
            {{ loading() ? 'Signing in…' : 'Sign In' }}
          </button>
        </form>

        <div class="login-footer">
          <span class="offline-badge">
            <span class="dot"></span>
            Works offline · syncs when you're back online
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
      background: var(--av-surface);
      border: 1px solid var(--av-border);
      border-radius: 20px;
      padding: 2.25rem;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 20px 40px -15px rgba(6, 60, 53, 0.18);
      color: var(--av-text);
    }
    .login-header {
      text-align: center;
      margin-bottom: 1.75rem;
    }
    .brand-logo {
      width: 84px;
      height: 84px;
      object-fit: contain;
      display: inline-block;
      margin-bottom: 0.5rem;
    }
    .brand-title {
      font-size: 1.45rem;
      font-weight: 700;
      margin: 0;
      letter-spacing: -0.02em;
    }
    .brand-desc {
      font-size: 0.82rem;
      color: var(--av-text-muted);
      margin: 4px 0 0 0;
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
      color: var(--av-text-body);
    }
    .form-input {
      background: var(--av-surface-2);
      border: 1px solid var(--av-border);
      border-radius: 10px;
      padding: 11px 14px;
      color: var(--av-text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s ease;
      width: 100%;
      box-sizing: border-box;
    }
    .form-input:focus {
      border-color: var(--av-gold);
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--av-red-text);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 500;
    }
    .btn-submit {
      background: linear-gradient(135deg, var(--av-forest), var(--av-forest-hover));
      color: white;
      border: none;
      padding: 12px;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 4px 12px rgba(6, 60, 53, 0.3);
      margin-top: 0.5rem;
    }
    .btn-submit:hover:not(:disabled) {
      background: linear-gradient(135deg, var(--av-forest-hover), var(--av-forest-deep));
      transform: translateY(-1px);
    }
    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .login-footer {
      margin-top: 1.75rem;
      text-align: center;
      border-top: 1px solid var(--av-border);
      padding-top: 1.25rem;
    }
    .offline-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      color: var(--av-text-muted);
    }
    .offline-badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--av-green);
    }
    /* ── Premium layer ─────────────────────────────────────────────── */
    .login-container {
      background:
        radial-gradient(900px 500px at 15% 10%, rgba(168, 124, 44, 0.10), transparent 60%),
        radial-gradient(700px 500px at 90% 90%, rgba(6, 60, 53, 0.08), transparent 60%);
    }
    .login-card {
      border-radius: 24px;
      border: 1px solid var(--av-border);
      padding: 2.75rem 2.5rem;
      position: relative;
      overflow: hidden;
      box-shadow: 0 30px 60px -30px rgba(6, 60, 53, 0.35);
    }
    .login-card::before {
      content: '';
      position: absolute;
      inset: 0 0 auto 0;
      height: 3px;
      background: linear-gradient(90deg, var(--av-forest), var(--av-gold), var(--av-forest));
    }
    .brand-title {
      font-family: var(--av-font-heading);
      font-size: 1.05rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.24em;
      color: var(--av-forest);
    }
    .brand-desc {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--av-gold-text);
      margin-top: 8px;
    }
    .form-label {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--av-text-muted);
    }
    .form-input { border-radius: 12px; background: var(--av-surface); }
    .form-input:focus { border-color: var(--av-gold); box-shadow: 0 0 0 3px rgba(168, 124, 44, 0.15); }
    .btn-submit {
      border-radius: 999px;
      background: var(--av-forest);
      letter-spacing: 0.04em;
    }
  `],
})
export class LoginComponent {
  username = '';
  pin = '';
  errorMessage = signal<string | null>(null);
  loading = signal<boolean>(false);

  constructor(private authService: AuthService) { }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);
    this.loading.set(true);

    const res = await this.authService.loginByUsername(this.username, this.pin);
    this.loading.set(false);

    if (!res.success) {
      this.errorMessage.set(res.message);
    }
  }
}
