import { Injectable } from '@angular/core';
import { getSupabaseClient } from '../supabase.config';

/**
 * Pushes live table changes instead of waiting for the next poll — e.g. so
 * pausing on one tab/device shows up on another right away, instead of up to
 * a minute later. This is purely an enhancement: the gate function (service
 * role) remains the only path for writes and for anything the app can't
 * afford to miss, so if a Realtime subscription never connects, the existing
 * polling just keeps working exactly as before.
 *
 * Needs a real Supabase Auth session (minted by the gate function at login,
 * see mintSupabaseSession in the gate function) — row-level security only
 * shows a signed-in person their own rows (or everything, for an admin).
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  // The client rehydrates a persisted session from storage asynchronously —
  // subscribing to a channel before that finishes connects the socket with
  // no auth attached, so it silently never receives anything under RLS.
  // Every subscribe waits for this first.
  private authReady: Promise<void> = getSupabaseClient()
    .auth.getSession()
    .then(() => undefined)
    .catch(() => undefined);

  /** Call once right after login with the session the gate function minted. */
  async setSession(session: { access_token: string; refresh_token: string } | null | undefined): Promise<void> {
    if (!session) return;
    this.authReady = getSupabaseClient()
      .auth.setSession(session)
      .then(() => undefined)
      .catch(() => undefined);
    await this.authReady;
  }

  clearSession(): void {
    getSupabaseClient().auth.signOut().catch(() => {});
  }

  /** Fires on any insert/update/delete to time_entries this person is allowed to see. */
  onTimeEntriesChange(callback: () => void, employeeId?: string): () => void {
    return this.subscribe('time_entries', callback, employeeId);
  }

  /** Fires on any insert/update/delete to time_pauses this person is allowed to see. */
  onTimePausesChange(callback: () => void, employeeId?: string): () => void {
    return this.subscribe('time_pauses', callback, employeeId);
  }

  /** `employeeId` narrows it to that person's rows (server-side), so unrelated changes never arrive. */
  private subscribe(table: string, callback: () => void, employeeId?: string): () => void {
    let cancelled = false;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;

    this.authReady.then(() => {
      if (cancelled) return;
      channel = getSupabaseClient()
        .channel(`${table}_changes_${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(employeeId ? { filter: `employee_id=eq.${employeeId}` } : {}) },
          () => callback()
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }
}
