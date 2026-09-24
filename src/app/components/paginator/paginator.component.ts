import { Component, computed, input, model } from '@angular/core';

/** Cut one page out of a list. `page` is 0-based and is kept in range if the list got shorter. */
export function pageSlice<T>(list: T[], page: number, size: number): T[] {
  const last = Math.max(0, Math.ceil(list.length / size) - 1);
  const start = Math.min(page, last) * size;
  return list.slice(start, start + size);
}

/**
 * Page controls under a long table or grid. Use:
 * <app-paginator [total]="rows.length" [(page)]="page" [(pageSize)]="size" unit="entries" />
 * Hidden when everything fits on one page.
 */
@Component({
  selector: 'app-paginator',
  standalone: true,
  template: `
    @if (total() > pageSizeOptions()[0]) {
      <div class="pager">
        <span class="pager-info">{{ from() }}–{{ to() }} of {{ total() }} {{ unit() }}</span>
        <div class="pager-controls">
          <label class="pager-size">
            Show
            <select [value]="pageSize()" (change)="setSize($any($event.target).value)">
              @for (n of pageSizeOptions(); track n) {
                <option [value]="n" [selected]="n === pageSize()">{{ n }}</option>
              }
            </select>
          </label>
          <button type="button" class="pager-btn" [disabled]="current() === 0" (click)="page.set(0)" title="First page">«</button>
          <button type="button" class="pager-btn" [disabled]="current() === 0" (click)="page.set(current() - 1)" title="Previous page">‹</button>
          <span class="pager-page">Page {{ current() + 1 }} of {{ pageCount() }}</span>
          <button type="button" class="pager-btn" [disabled]="current() >= pageCount() - 1" (click)="page.set(current() + 1)" title="Next page">›</button>
          <button type="button" class="pager-btn" [disabled]="current() >= pageCount() - 1" (click)="page.set(pageCount() - 1)" title="Last page">»</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pager {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 4px 4px;
      font-size: 0.82rem;
      color: var(--av-text-muted);
    }
    .pager-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pager-size { display: flex; align-items: center; gap: 6px; margin-right: 6px; }
    .pager-size select {
      padding: 4px 6px;
      border: 1px solid var(--av-border);
      border-radius: 8px;
      background: var(--av-surface);
      color: inherit;
      font: inherit;
    }
    .pager-page { min-width: 92px; text-align: center; font-variant-numeric: tabular-nums; }
    .pager-btn {
      min-width: 32px;
      height: 32px;
      border: 1px solid var(--av-border);
      border-radius: 999px;
      background: var(--av-surface);
      color: var(--av-forest);
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
    }
    .pager-btn:hover:not(:disabled) { border-color: var(--av-gold); }
    .pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  `],
})
export class PaginatorComponent {
  readonly total = input.required<number>();
  readonly page = model<number>(0);
  readonly pageSize = model<number>(25);
  readonly pageSizeOptions = input<number[]>([25, 50, 100]);
  /** What is being counted, e.g. "entries" or "days". */
  readonly unit = input<string>('items');

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  /** The page shown, kept in range when the list shrinks (e.g. after filtering). */
  readonly current = computed(() => Math.min(this.page(), this.pageCount() - 1));
  readonly from = computed(() => (this.total() === 0 ? 0 : this.current() * this.pageSize() + 1));
  readonly to = computed(() => Math.min(this.total(), (this.current() + 1) * this.pageSize()));

  setSize(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(0);
  }
}
