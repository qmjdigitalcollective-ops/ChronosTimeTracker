import { Injectable, signal } from '@angular/core';

/** Lets the top bar ask the admin area to open a page (e.g. "My Timer"). */
@Injectable({ providedIn: 'root' })
export class NavService {
  readonly requestedTab = signal<string | null>(null);

  open(tab: string): void {
    this.requestedTab.set(tab);
  }
}
