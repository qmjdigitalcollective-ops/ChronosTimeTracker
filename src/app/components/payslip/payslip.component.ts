import { Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MoneyPipe } from '../../pipes/money.pipe';
import { IconComponent } from '../icon/icon.component';
import { Payout, TimeEntry } from '../../models/time-tracker.models';

type PayslipDetail = 'client' | 'task';

interface PayslipLine {
  project: string;
  task?: string;
  rate: number;
  hours: number;
  amount: number;
}

/**
 * A payslip for one "Mark as paid" record: hours per project, rate and amount.
 * "Print / Save as PDF" uses the browser's print window (choose "Save as PDF").
 */
@Component({
  selector: 'app-payslip',
  standalone: true,
  imports: [CommonModule, MoneyPipe, IconComponent],
  template: `
    <div class="slip-overlay" (click)="closed.emit()">
      <div class="slip-wrap" (click)="$event.stopPropagation()">
        <div class="slip-actions no-print">
          <div class="slip-detail-toggle">
            <button type="button" [class.active]="detail() === 'client'" (click)="setDetail('client')">By client</button>
            <button type="button" [class.active]="detail() === 'task'" (click)="setDetail('task')">By task</button>
          </div>
          <button type="button" class="slip-btn primary" (click)="print()">
            <app-icon name="download" [size]="15" /> Print / Save as PDF
          </button>
          <button type="button" class="slip-btn" (click)="closed.emit()"><app-icon name="x" [size]="15" /> Close</button>
        </div>

        <article class="payslip-sheet">
          <header class="slip-head">
            <div class="slip-brand">
              <img src="auravia-mark.png" alt="" />
              <div>
                <div class="slip-company">AURAVIA COLLECTIVE</div>
                <div class="slip-kicker">Payslip</div>
              </div>
            </div>
            <div class="slip-paid"><app-icon name="check" [size]="14" /> Paid</div>
          </header>

          <section class="slip-meta">
            <div>
              <span class="lbl">Team member</span>
              <strong>{{ payout().employeeName }}</strong>
              @if (email()) { <span class="sub">{{ email() }}</span> }
            </div>
            <div>
              <span class="lbl">Pay period</span>
              <strong>{{ day(payout().periodStart) }} – {{ day(payout().periodEnd) }}</strong>
            </div>
            <div>
              <span class="lbl">Paid on</span>
              <strong>{{ day(payout().paidAt) }}</strong>
              @if (payout().note) { <span class="sub">{{ payout().note }}</span> }
            </div>
          </section>

          <table class="slip-table">
            <thead>
              <tr>
                <th>Project</th>
                @if (detail() === 'task') { <th>Task</th> }
                <th class="r">Hours</th>
                <th class="r">Rate</th>
                <th class="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              @for (line of lines(); track line.project + (line.task || '')) {
                <tr>
                  <td>{{ line.project }}</td>
                  @if (detail() === 'task') { <td class="muted">{{ line.task }}</td> }
                  <td class="r">{{ line.hours | number: '1.2-2' }}</td>
                  <td class="r">{{ line.rate | money: true }}</td>
                  <td class="r">{{ line.amount | money }}</td>
                </tr>
              } @empty {
                <tr><td [attr.colspan]="detail() === 'task' ? 5 : 4" class="muted">No time details found for this period.</td></tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td [attr.colspan]="detail() === 'task' ? 2 : 1">Total from time tracked</td>
                <td class="r">{{ totalHours() | number: '1.2-2' }}</td>
                <td></td>
                <td class="r">{{ computedTotal() | money }}</td>
              </tr>
              @if (adjustment() !== 0) {
                <tr class="adj">
                  <td [attr.colspan]="detail() === 'task' ? 4 : 3">Adjustment</td>
                  <td class="r">{{ adjustment() | money }}</td>
                </tr>
              }
              <tr class="grand">
                <td [attr.colspan]="detail() === 'task' ? 4 : 3">Amount paid</td>
                <td class="r">{{ payout().amount | money }}</td>
              </tr>
            </tfoot>
          </table>

          <footer class="slip-foot">
            Auravia Collective · Payslip generated {{ day(now) }} · Questions? Message Queen.
          </footer>
        </article>
      </div>
    </div>
  `,
  styles: [`
    .slip-overlay {
      position: fixed;
      inset: 0;
      background: rgba(6, 40, 35, 0.55);
      backdrop-filter: blur(4px);
      z-index: 4000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: auto;
      padding: 2rem 1rem;
    }
    .slip-wrap { width: 100%; max-width: 720px; }
    .slip-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 10px; }
    .slip-detail-toggle {
      display: inline-flex;
      border: 1px solid var(--av-border-strong);
      border-radius: 999px;
      overflow: hidden;
      margin-right: auto;
    }
    .slip-detail-toggle button {
      background: var(--av-surface);
      color: var(--av-forest);
      border: none;
      padding: 8px 14px;
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .slip-detail-toggle button.active { background: var(--av-forest); color: var(--av-ivory); }
    .slip-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--av-border-strong); background: var(--av-surface); color: var(--av-forest);
      border-radius: 999px; padding: 8px 16px; font: inherit; font-size: 0.85rem; cursor: pointer;
    }
    .slip-btn.primary { background: var(--av-forest); color: var(--av-ivory); border-color: var(--av-forest); }
    .payslip-sheet {
      background: #fff;
      color: #063c35;
      border-radius: 18px;
      padding: 2.25rem;
      box-shadow: 0 30px 60px -30px rgba(6, 60, 53, 0.5);
      border-top: 4px solid #a87c2c;
    }
    .slip-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    .slip-brand { display: flex; align-items: center; gap: 12px; }
    .slip-brand img { width: 52px; height: 52px; object-fit: contain; }
    .slip-company { font-family: var(--av-font-heading); font-weight: 600; letter-spacing: 0.2em; font-size: 0.95rem; }
    .slip-kicker { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.18em; color: #8a6420; margin-top: 3px; }
    .slip-paid {
      display: inline-flex; align-items: center; gap: 5px;
      background: rgba(46, 125, 91, 0.12); color: #1f6b4a;
      padding: 5px 12px; border-radius: 999px; font-size: 0.78rem; font-weight: 600;
    }
    .slip-meta {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;
      margin: 1.75rem 0 1.25rem; padding: 1rem 0; border-top: 1px solid #efe6d6; border-bottom: 1px solid #efe6d6;
    }
    .slip-meta div { display: flex; flex-direction: column; gap: 3px; font-size: 0.88rem; }
    .lbl { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.12em; color: #6b7a6f; }
    .sub { font-size: 0.75rem; color: #6b7a6f; }
    .slip-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    .slip-table th {
      text-align: left; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: #6b7a6f; padding: 8px 6px; border-bottom: 1px solid #e6dac6;
    }
    .slip-table td { padding: 9px 6px; border-bottom: 1px solid #f3ecdf; font-variant-numeric: tabular-nums; }
    .slip-table .r { text-align: right; }
    .slip-table tfoot td { border-bottom: none; font-weight: 600; }
    .slip-table tr.adj td { font-weight: 500; color: #8a6420; }
    .slip-table tr.grand td {
      font-family: var(--av-font-heading); font-size: 1.15rem; color: #063c35;
      border-top: 2px solid #063c35; padding-top: 12px;
    }
    .muted { color: #8a8f7c; text-align: center; }
    .slip-foot { margin-top: 2rem; font-size: 0.72rem; color: #8a8f7c; text-align: center; }
    @media (max-width: 600px) {
      .payslip-sheet { padding: 1.25rem; }
      .slip-meta { grid-template-columns: 1fr; }
    }
  `],
})
export class PayslipComponent {
  payout = input.required<Payout>();
  /** The member's time entries (any dates; only the pay period is used). */
  entries = input<TimeEntry[]>([]);
  email = input<string>('');
  closed = output<void>();

  readonly now = Date.now();

  /** "By client" (one row per project) or "by task" (one row per task within each project). Your choice, remembered on this device. */
  detail = signal<PayslipDetail>(this.readDetailPref());

  private readDetailPref(): PayslipDetail {
    try {
      return localStorage.getItem('auravia_payslip_detail') === 'task' ? 'task' : 'client';
    } catch {
      return 'client';
    }
  }

  lines = computed<PayslipLine[]>(() => {
    const p = this.payout();
    const byTask = this.detail() === 'task';
    const end = p.periodEnd + 24 * 60 * 60 * 1000;
    // Group by project only (client mode), or by project + task (task mode). Individual
    // entries can carry tiny rounding differences in their per-entry rate (e.g. ₱88.00 vs
    // ₱87.99), so grouping by exact rate would split one project into near-identical rows.
    // The rate shown is the blended average for the row (amount ÷ hours).
    const map = new Map<string, PayslipLine>();
    for (const e of this.entries()) {
      if (e.employeeId !== p.employeeId || e.startTime < p.periodStart || e.startTime >= end) continue;
      const key = byTask ? `${e.clientName}|${e.taskDescription}` : e.clientName;
      const line = map.get(key) ?? { project: e.clientName, task: byTask ? e.taskDescription : undefined, rate: 0, hours: 0, amount: 0 };
      line.hours += e.durationSeconds / 3600;
      line.amount += e.totalPay || 0;
      map.set(key, line);
    }
    for (const line of map.values()) {
      line.rate = line.hours > 0 ? Math.round((line.amount / line.hours) * 100) / 100 : 0;
    }
    return [...map.values()].sort((a, b) => a.project.localeCompare(b.project) || b.amount - a.amount);
  });

  totalHours = computed(() => this.lines().reduce((a, l) => a + l.hours, 0));
  computedTotal = computed(() => this.lines().reduce((a, l) => a + l.amount, 0));
  /** Paid amount minus what the time adds up to (e.g. a bonus, or hours edited after paying). */
  adjustment = computed(() => Math.round((this.payout().amount - this.computedTotal()) * 100) / 100);

  day(ms: number): string {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  setDetail(value: PayslipDetail): void {
    this.detail.set(value);
    try {
      localStorage.setItem('auravia_payslip_detail', value);
    } catch {}
  }

  print(): void {
    document.body.classList.add('printing-payslip');
    const done = () => {
      document.body.classList.remove('printing-payslip');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }
}
