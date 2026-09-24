import { Injectable, signal } from '@angular/core';
import { OfflineStorageService } from './offline-storage.service';
import { ScreenshotService } from './screenshot.service';
import { payRateFor } from './rates';
import { effectivePermissions } from './permissions';
import { SupabaseSyncService } from './google-sync.service';
import {
  Employee,
  Client,
  TimeEntry,
  ScreenshotRecord,
  EntryStatus,
} from '../models/time-tracker.models';

@Injectable({
  providedIn: 'root',
})
export class TimerService {
  readonly activeEntry = signal<TimeEntry | null>(null);
  readonly status = signal<EntryStatus>('completed');
  readonly elapsedSeconds = signal<number>(0);
  readonly pausedSeconds = signal<number>(0);
  readonly nextScreenshotSeconds = signal<number>(600); // 10 minutes default
  readonly currentSessionScreenshots = signal<ScreenshotRecord[]>([]);
  readonly todayEntries = signal<TimeEntry[]>([]);
  readonly isTakingScreenshot = signal<boolean>(false);

  private tickerIntervalId: any = null;
  /** Team Access → "Screenshots" for the person whose timer is running */
  private screenshotsAllowed = true;
  private intervalMinutes = 10;

  constructor(
    private offlineStorage: OfflineStorageService,
    private screenshotService: ScreenshotService,
    private supabaseSync: SupabaseSyncService
  ) {
    // The running timer is restored per signed-in person (see restoreActiveSession),
    // so one person never picks up someone else's timer.
    this.loadTodayEntries();
  }

  /** Restore the signed-in person's own running/paused timer (if any). */
  async restoreActiveSession(employeeId: string): Promise<void> {
    // Reset whatever the previous person on this device had loaded
    if (this.tickerIntervalId) {
      clearInterval(this.tickerIntervalId);
      this.tickerIntervalId = null;
    }
    this.activeEntry.set(null);
    this.status.set('completed');
    this.elapsedSeconds.set(0);
    this.pausedSeconds.set(0);
    this.currentSessionScreenshots.set([]);

    try {
      const settings = await this.offlineStorage.getSettings();
      this.intervalMinutes = settings.screenshotIntervalMinutes || 10;
      this.nextScreenshotSeconds.set(this.intervalMinutes * 60);

      const active = await this.offlineStorage.getActiveTimeEntry(employeeId);
      if (active) {
        const me = await this.offlineStorage.getEmployeeById(employeeId);
        this.screenshotsAllowed = effectivePermissions(await this.offlineStorage.getPermissions(), me).screenshots;
        this.activeEntry.set(active);
        this.status.set(active.status);

        // Recalculate true elapsed seconds
        const now = Date.now();
        let totalElapsed = active.durationSeconds;
        let paused = active.pausedSeconds;

        if (active.status === 'active') {
          // If was active when closed/refreshed, compute elapsed since startTime minus paused
          const wallClockSeconds = Math.max(0, Math.floor((now - active.startTime) / 1000));
          totalElapsed = Math.max(active.durationSeconds, wallClockSeconds - paused);
          this.startTicker();
        } else if (active.status === 'paused' && active.lastPauseTime) {
          // Add extra paused time while page was away
          const additionalPaused = Math.max(0, Math.floor((now - active.lastPauseTime) / 1000));
          paused += additionalPaused;
          active.pausedSeconds = paused;
          await this.offlineStorage.saveTimeEntry(active);
        }

        this.elapsedSeconds.set(totalElapsed);
        this.pausedSeconds.set(paused);

        // Load screenshots for this session
        const screenshots = await this.offlineStorage.getScreenshots(active.id);
        this.currentSessionScreenshots.set(screenshots);
      }
    } catch (e) {
      console.error('Failed to restore active time session:', e);
    }
  }

  async loadTodayEntries(): Promise<void> {
    try {
      const entries = await this.offlineStorage.getTimeEntries();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const today = entries.filter((e) => e.startTime >= todayStart.getTime());
      this.todayEntries.set(today);
    } catch (e) {
      console.error('Failed to load today entries:', e);
    }
  }

  async clockIn(employee: Employee, client: Client, taskDescription: string): Promise<boolean> {
    if (this.activeEntry()) {
      console.warn('A session is already active');
      return false;
    }

    const cleanTask = taskDescription.trim() || 'General work';

    // Request screen permission on clock-in
    await this.screenshotService.requestScreenPermission();

    const settings = await this.offlineStorage.getSettings();
    this.intervalMinutes = settings.screenshotIntervalMinutes || 10;

    // Pay rate for this member on this client (Contracts), else their default rate
    const contracts = await this.offlineStorage.getContracts();
    const hourlyRate = payRateFor(contracts, employee, client.id);
    this.screenshotsAllowed = effectivePermissions(await this.offlineStorage.getPermissions(), employee).screenshots;

    const now = Date.now();
    const entryId = 'entry_' + now + '_' + Math.random().toString(36).substring(2, 7);

    const newEntry: TimeEntry = {
      id: entryId,
      employeeId: employee.id,
      employeeName: employee.name,
      clientId: client.id,
      clientName: client.name,
      taskDescription: cleanTask,
      startTime: now,
      durationSeconds: 0,
      pausedSeconds: 0,
      status: 'active',
      hourlyRate,
      totalPay: 0,
      screenshotCount: 0,
      syncStatus: 'pending',
    };

    await this.offlineStorage.saveTimeEntry(newEntry);
    this.activeEntry.set(newEntry);
    this.status.set('active');
    this.elapsedSeconds.set(0);
    this.pausedSeconds.set(0);
    this.nextScreenshotSeconds.set(this.intervalMinutes * 60);
    this.currentSessionScreenshots.set([]);

    this.startTicker();
    await this.supabaseSync.checkPendingCounts();

    // Trigger an initial capture 2 seconds in to verify capture is working
    setTimeout(() => {
      if (this.status() === 'active') {
        this.captureScreenshot();
      }
    }, 2000);

    return true;
  }

  async pause(): Promise<void> {
    const entry = this.activeEntry();
    if (!entry || this.status() !== 'active') return;

    this.stopTicker();
    const now = Date.now();

    entry.status = 'paused';
    entry.lastPauseTime = now;
    entry.durationSeconds = this.elapsedSeconds();
    entry.totalPay = (entry.durationSeconds / 3600) * entry.hourlyRate;

    await this.offlineStorage.saveTimeEntry(entry);
    this.activeEntry.set(entry);
    this.status.set('paused');
  }

  async resume(): Promise<void> {
    const entry = this.activeEntry();
    if (!entry || this.status() !== 'paused') return;

    const now = Date.now();
    if (entry.lastPauseTime) {
      const addedPaused = Math.max(0, Math.floor((now - entry.lastPauseTime) / 1000));
      entry.pausedSeconds = (entry.pausedSeconds || 0) + addedPaused;
      this.pausedSeconds.set(entry.pausedSeconds);
      delete entry.lastPauseTime;
    }

    entry.status = 'active';
    await this.offlineStorage.saveTimeEntry(entry);
    this.activeEntry.set(entry);
    this.status.set('active');

    this.startTicker();
  }

  async clockOut(): Promise<TimeEntry | null> {
    const entry = this.activeEntry();
    if (!entry) return null;

    this.stopTicker();
    const now = Date.now();

    // Finalize duration and earnings
    const finalDuration = this.elapsedSeconds();
    entry.durationSeconds = finalDuration;
    entry.endTime = now;
    entry.status = 'completed';
    entry.totalPay = parseFloat(((finalDuration / 3600) * entry.hourlyRate).toFixed(2));
    delete entry.lastPauseTime;

    await this.offlineStorage.saveTimeEntry(entry);

    // Stop screen capture
    this.screenshotService.stopScreenCapture();

    // Reset state
    this.activeEntry.set(null);
    this.status.set('completed');
    this.elapsedSeconds.set(0);
    this.pausedSeconds.set(0);
    this.currentSessionScreenshots.set([]);

    await this.loadTodayEntries();
    await this.supabaseSync.checkPendingCounts();
    await this.supabaseSync.autoSyncIfEnabled();

    return entry;
  }

  async captureScreenshot(): Promise<ScreenshotRecord | null> {
    const entry = this.activeEntry();
    if (!entry || !this.screenshotsAllowed) return null;

    this.isTakingScreenshot.set(true);

    try {
      const frame = await this.screenshotService.captureFrame({
        employeeName: entry.employeeName,
        clientName: entry.clientName,
        taskDescription: entry.taskDescription,
      });

      if (!frame.full) {
        this.isTakingScreenshot.set(false);
        return null;
      }

      const now = Date.now();
      const ssRecord: ScreenshotRecord = {
        id: 'ss_' + now + '_' + Math.random().toString(36).substring(2, 7),
        timeEntryId: entry.id,
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        timestamp: now,
        imageDataUrl: frame.full,
        thumbnailDataUrl: frame.thumb,
        synced: false,
      };

      await this.offlineStorage.saveScreenshot(ssRecord);

      // Update entry screenshot count
      entry.screenshotCount = (entry.screenshotCount || 0) + 1;
      await this.offlineStorage.saveTimeEntry(entry);
      this.activeEntry.set({ ...entry });

      // Update session screenshots signal
      this.currentSessionScreenshots.update((list) => [ssRecord, ...list]);

      // Reset countdown
      this.nextScreenshotSeconds.set(this.intervalMinutes * 60);

      await this.supabaseSync.checkPendingCounts();
      await this.supabaseSync.autoSyncIfEnabled();

      return ssRecord;
    } catch (e) {
      console.error('Failed to take screenshot:', e);
      return null;
    } finally {
      this.isTakingScreenshot.set(false);
    }
  }

  updateIntervalMinutes(minutes: number): void {
    this.intervalMinutes = Math.max(1, minutes);
    this.nextScreenshotSeconds.set(this.intervalMinutes * 60);
  }

  private startTicker(): void {
    this.stopTicker();
    this.tickerIntervalId = setInterval(async () => {
      if (this.status() === 'active') {
        const nextElapsed = this.elapsedSeconds() + 1;
        this.elapsedSeconds.set(nextElapsed);

        // Every 30 seconds persist current duration
        if (nextElapsed % 30 === 0 && this.activeEntry()) {
          const entry = this.activeEntry()!;
          entry.durationSeconds = nextElapsed;
          entry.totalPay = (nextElapsed / 3600) * entry.hourlyRate;
          this.offlineStorage.saveTimeEntry(entry).catch(() => {});
        }

        // Countdown for screenshots
        const nextCd = this.nextScreenshotSeconds() - 1;
        if (nextCd <= 0) {
          this.nextScreenshotSeconds.set(this.intervalMinutes * 60);
          this.captureScreenshot();
        } else {
          this.nextScreenshotSeconds.set(nextCd);
        }
      }
    }, 1000);
  }

  private stopTicker(): void {
    if (this.tickerIntervalId) {
      clearInterval(this.tickerIntervalId);
      this.tickerIntervalId = null;
    }
  }
}
