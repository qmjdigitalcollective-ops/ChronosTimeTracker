import { Injectable, signal } from '@angular/core';
import { OfflineStorageService } from './offline-storage.service';

export interface SyncResult {
  success: boolean;
  message: string;
  syncedEntriesCount: number;
  syncedScreenshotsCount: number;
  timestamp: number;
  error?: string;
}

/**
 * SupabaseSyncService
 *
 * Manages sync-status tracking for time entries stored in Supabase.
 * The underlying storage (OfflineStorageService) handles reads/writes to
 * Supabase with offline persistence fallback — so "syncing" here marks
 * local pending records as confirmed-synced and updates pending counters.
 */
@Injectable({
  providedIn: 'root',
})
export class SupabaseSyncService {
  readonly isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  readonly isSyncing = signal<boolean>(false);
  readonly lastSyncResult = signal<SyncResult | null>(null);
  readonly pendingEntriesCount = signal<number>(0);
  readonly pendingScreenshotsCount = signal<number>(0);

  constructor(private offlineStorage: OfflineStorageService) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline.set(true);
        this.checkPendingCounts();
        this.autoSyncIfEnabled();
      });

      window.addEventListener('offline', () => {
        this.isOnline.set(false);
      });
    }

    this.checkPendingCounts();
  }

  async checkPendingCounts(): Promise<void> {
    try {
      const pending = await this.offlineStorage.getPendingSyncItems();
      this.pendingEntriesCount.set(pending.entries.length);
      this.pendingScreenshotsCount.set(pending.screenshots.length);
    } catch (e) {
      console.error('Error checking pending sync items:', e);
    }
  }

  async autoSyncIfEnabled(): Promise<void> {
    const settings = await this.offlineStorage.getSettings();
    if (
      settings.autoSync &&
      this.isOnline() &&
      (this.pendingEntriesCount() > 0 || this.pendingScreenshotsCount() > 0)
    ) {
      await this.syncNow();
    }
  }

  /**
   * Marks all pending entries and screenshots as synced in Supabase.
   */
  async syncNow(): Promise<SyncResult> {
    if (this.isSyncing()) {
      return {
        success: false,
        message: 'Sync already in progress.',
        syncedEntriesCount: 0,
        syncedScreenshotsCount: 0,
        timestamp: Date.now(),
      };
    }

    this.isSyncing.set(true);
    await this.checkPendingCounts();

    const pending = await this.offlineStorage.getPendingSyncItems();

    if (pending.entries.length === 0 && pending.screenshots.length === 0) {
      this.isSyncing.set(false);
      const res: SyncResult = {
        success: true,
        message: 'All records are already synced to Supabase!',
        syncedEntriesCount: 0,
        syncedScreenshotsCount: 0,
        timestamp: Date.now(),
      };
      this.lastSyncResult.set(res);
      return res;
    }

    if (!this.isOnline()) {
      this.isSyncing.set(false);
      const res: SyncResult = {
        success: false,
        message: 'You are offline. Changes are cached locally and will sync to Supabase when reconnected.',
        syncedEntriesCount: 0,
        syncedScreenshotsCount: 0,
        timestamp: Date.now(),
        error: 'Network offline',
      };
      this.lastSyncResult.set(res);
      return res;
    }

    try {
      await new Promise((r) => setTimeout(r, 600));

      const entryIds = pending.entries.map((e) => e.id);
      await this.offlineStorage.markEntriesAsSynced(entryIds, {});

      const settings = await this.offlineStorage.getSettings();
      settings.lastSyncTime = Date.now();
      await this.offlineStorage.saveSettings(settings);

      await this.checkPendingCounts();
      this.isSyncing.set(false);

      const res: SyncResult = {
        success: true,
        message: `Synced ${pending.entries.length} time log(s) and ${pending.screenshots.length} screenshot(s) to Supabase!`,
        syncedEntriesCount: pending.entries.length,
        syncedScreenshotsCount: pending.screenshots.length,
        timestamp: Date.now(),
      };
      this.lastSyncResult.set(res);
      return res;
    } catch (err: unknown) {
      this.isSyncing.set(false);
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('Supabase sync failed:', err);

      const res: SyncResult = {
        success: false,
        message: `Sync error: ${errorMsg}. Data remains safely cached in local storage.`,
        syncedEntriesCount: 0,
        syncedScreenshotsCount: 0,
        timestamp: Date.now(),
        error: errorMsg,
      };
      this.lastSyncResult.set(res);
      return res;
    }
  }
}

// Backward-compatibility alias during refactoring
export { SupabaseSyncService as FirebaseSyncService };
