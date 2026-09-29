import { Injectable, signal } from '@angular/core';
import { DataService } from './data.service';
import { ScreenshotService } from './screenshot.service';
import { payRateFor } from './rates';
import { effectivePermissions } from './permissions';
import {
  Employee,
  Client,
  TimeEntry,
  ScreenshotRecord,
  EntryStatus,
  PauseReason,
  PAUSE_REASONS,
  TimePause,
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
  /** True when the current pause was triggered automatically by 2 minutes of
   * no mouse/keyboard activity on the computer, not a manual "Pause Shift"
   * click — so the UI can explain why the timer stopped. Desktop app only;
   * a browser tab has no way to see activity outside itself. */
  readonly pausedForIdle = signal<boolean>(false);

  /** The pause currently in progress (why the timer is stopped) */
  readonly currentPause = signal<TimePause | null>(null);

  private tickerIntervalId: any = null;
  /** Team Access → "Screenshots" for the person whose timer is running */
  private screenshotsAllowed = true;
  private intervalMinutes = 10;

  constructor(
    private db: DataService,
    private screenshotService: ScreenshotService
  ) {
    // The running timer is restored per signed-in person (see restoreActiveSession),
    // so one person never picks up someone else's timer.
    this.loadTodayEntries();
    this.watchIdle();
  }

  /** Auto-pause after 2 minutes away from the keyboard/mouse (desktop app only). */
  private watchIdle(): void {
    const api = (window as any).electronAPI;
    if (!api?.isElectron) {
      this.watchIdleInBrowser();
      return;
    }

    api.onIdleStarted(() => {
      if (this.status() === 'active') {
        this.pausedForIdle.set(true);
        this.pause('idle');
      }
    });

    api.onIdleEnded(() => {
      // Coming back doesn't auto-resume the clock — the person still has to
      // press Resume themselves, same as a manual pause, so idle time never
      // gets counted just because they walked back to their desk.
      this.pausedForIdle.set(false);
    });
  }

  /**
   * Website version: pause after 3 minutes with no activity and show a system
   * notification that brings them back. Uses Chrome's Idle Detection API when
   * allowed (sees the whole computer); otherwise falls back to activity inside
   * this tab, and only while the tab is visible — a hidden tab can't tell
   * "away" from "working in another app".
   */
  private watchIdleInBrowser(): void {
    const IDLE_SECONDS = 180;
    let lastActivity = Date.now();
    const touch = () => (lastActivity = Date.now());
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel']) {
      window.addEventListener(ev, touch, { passive: true });
    }

    const goIdle = (awaySeconds: number) => {
      if (this.status() !== 'active') return;
      this.pausedForIdle.set(true);
      this.pause('idle', awaySeconds);
      this.notifyIdle();
    };

    const Detector = (window as any).IdleDetector;
    this.systemIdleWatching = false;
    this.startSystemIdle = async () => {
      if (this.systemIdleWatching || !Detector) return;
      try {
        if ((await Detector.requestPermission()) !== 'granted') return;
        const detector = new Detector();
        detector.addEventListener('change', () => {
          if (detector.userState === 'idle' || detector.screenState === 'locked') goIdle(IDLE_SECONDS);
          else this.pausedForIdle.set(false);
        });
        await detector.start({ threshold: IDLE_SECONDS * 1000 });
        this.systemIdleWatching = true;
      } catch {
        // Not allowed or unsupported — the in-tab fallback below still runs.
      }
    };

    setInterval(() => {
      if (this.systemIdleWatching || document.visibilityState !== 'visible') return;
      const idleFor = Math.floor((Date.now() - lastActivity) / 1000);
      if (idleFor >= IDLE_SECONDS) goIdle(idleFor);
    }, 5000);
  }

  private systemIdleWatching = false;
  private startSystemIdle: () => Promise<void> = async () => {};

  private notifyIdle(): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification('Your timer was paused', {
      body: 'No activity for 3 minutes. Click to go back and press Resume.',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }

  /** Ask (once, from a click) for the browser permissions idle-stop needs. */
  private requestIdlePermissions(): void {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
    } catch {}
    void this.startSystemIdle();
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
    this.pausedForIdle.set(false);
    this.currentPause.set(null);
    this.currentSessionScreenshots.set([]);

    try {
      const settings = await this.db.getSettings();
      this.intervalMinutes = settings.screenshotIntervalMinutes || 10;
      this.nextScreenshotSeconds.set(this.intervalMinutes * 60);

      const active = await this.db.getActiveTimeEntry(employeeId);
      if (active) {
        const me = await this.db.getEmployeeById(employeeId);
        this.screenshotsAllowed = effectivePermissions(await this.db.getPermissions(), me).screenshots;
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
          // Display only — resume() adds the full paused stretch once; saving it here as well
          // counted the same pause twice.
          paused += Math.max(0, Math.floor((now - active.lastPauseTime) / 1000));
        }

        this.elapsedSeconds.set(totalElapsed);
        this.pausedSeconds.set(paused);

        // Load screenshots for this session
        const screenshots = await this.db.getScreenshots(active.id);
        this.currentSessionScreenshots.set(screenshots);
      }
    } catch (e) {
      console.error('Failed to restore active time session:', e);
    }
  }

  async loadTodayEntries(): Promise<void> {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      this.todayEntries.set(await this.db.getTimeEntries({ since: todayStart.getTime() }));
    } catch (e) {
      console.error('Failed to load today entries:', e);
    }
  }

  private startingNow = false;

  async clockIn(employee: Employee, client: Client, taskDescription: string): Promise<boolean> {
    // Clock-in takes a moment; a second click during that wait used to start a
    // second timer (two overlapping entries, double-counted).
    if (this.startingNow) return false;
    this.startingNow = true;
    try {
      return await this.clockInNow(employee, client, taskDescription);
    } finally {
      this.startingNow = false;
    }
  }

  private async clockInNow(employee: Employee, client: Client, taskDescription: string): Promise<boolean> {
    if (this.activeEntry()) {
      console.warn('A session is already active');
      return false;
    }

    // Must run straight from the click, before any awaiting
    this.requestIdlePermissions();

    // Also check the database, not just this tab's memory — catches an active
    // timer started from another device or tab before this one loaded it.
    // These reads don't depend on each other, so fetch them together (one
    // round trip instead of four back to back — clock-in felt slow otherwise).
    const [existing, contracts, settings, permissions] = await Promise.all([
      this.db.getActiveTimeEntry(employee.id),
      this.db.getContracts(),
      this.db.getSettings(),
      this.db.getPermissions(),
    ]);
    if (existing) {
      console.warn('An active session already exists for this person on another device/tab');
      await this.restoreActiveSession(employee.id);
      return false;
    }

    // Pay rate for this member on this client (Contracts), else their default rate
    const hourlyRate = payRateFor(contracts, employee, client.id);

    // A contract's weekly hour limit is a hard stop, not just a warning on the
    // admin's Contracts page — check hours already logged this week before starting.
    const contract = contracts.find((c) => c.employeeId === employee.id && c.clientId === client.id && c.active !== false);
    if (contract?.weeklyLimitHours) {
      const now = new Date();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
      const weekEntries = await this.db.getTimeEntries({ employeeId: employee.id, since: monday.getTime() });
      const hoursThisWeek =
        weekEntries.filter((e) => e.clientId === client.id).reduce((acc, e) => acc + e.durationSeconds, 0) / 3600;
      if (hoursThisWeek >= contract.weeklyLimitHours) {
        throw new Error(
          `Weekly limit reached for ${client.name} (${contract.weeklyLimitHours}h). Ask an admin to raise it if this is expected.`
        );
      }
    }

    const cleanTask = taskDescription.trim() || 'General work';

    this.intervalMinutes = settings.screenshotIntervalMinutes || 10;
    this.screenshotsAllowed = effectivePermissions(permissions, employee).screenshots;

    // Only ask for screen access when this person's screenshots are on —
    // otherwise the OS shows a screen-recording prompt for nothing.
    if (this.screenshotsAllowed) await this.screenshotService.requestScreenPermission();

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
    };

    await this.db.saveTimeEntry(newEntry);
    this.activeEntry.set(newEntry);
    this.status.set('active');
    this.elapsedSeconds.set(0);
    this.pausedSeconds.set(0);
    this.nextScreenshotSeconds.set(this.intervalMinutes * 60);
    this.currentSessionScreenshots.set([]);

    this.startTicker();

    // Trigger an initial capture 2 seconds in to verify capture is working
    setTimeout(() => {
      if (this.status() === 'active') {
        this.captureScreenshot();
      }
    }, 2000);

    return true;
  }

  /** `awaySeconds`: how long the person was already idle — that stretch isn't counted as work. */
  async pause(reason: PauseReason = 'other', awaySeconds = 0): Promise<void> {
    const entry = this.activeEntry();
    if (!entry || this.status() !== 'active') return;

    this.stopTicker();
    const now = Date.now() - awaySeconds * 1000;

    entry.status = 'paused';
    entry.lastPauseTime = now;
    entry.durationSeconds = Math.max(0, this.wallElapsedSeconds() - awaySeconds);
    entry.totalPay = (entry.durationSeconds / 3600) * entry.hourlyRate;

    const pause: TimePause = {
      id: 'pause_' + now + '_' + Math.random().toString(36).substring(2, 6),
      timeEntryId: entry.id,
      employeeId: entry.employeeId,
      reason,
      paid: PAUSE_REASONS.find((r) => r.key === reason)?.paid ?? false,
      startedAt: now,
    };
    this.currentPause.set(pause);

    await this.db.saveTimeEntry(entry);
    this.db.savePause(pause).catch(() => {});
    this.activeEntry.set(entry);
    this.status.set('paused');
  }

  async resume(): Promise<void> {
    const entry = this.activeEntry();
    if (!entry || this.status() !== 'paused') return;

    const now = Date.now();
    let pause = this.currentPause();
    if (!pause) {
      const open = (await this.db.getPauses(entry.id).catch(() => [] as TimePause[])).filter((p) => !p.endedAt);
      pause = open[open.length - 1] ?? null;
    }
    if (pause) {
      pause.endedAt = now;
      this.db.savePause(pause).catch(() => {});
      this.currentPause.set(null);
    }
    // Paid pauses (meetings, technical problems) still count as work
    if (entry.lastPauseTime && !(pause?.paid)) {
      const addedPaused = Math.max(0, Math.floor((now - entry.lastPauseTime) / 1000));
      entry.pausedSeconds = (entry.pausedSeconds || 0) + addedPaused;
      this.pausedSeconds.set(entry.pausedSeconds);
      delete entry.lastPauseTime;
    }

    entry.status = 'active';
    await this.db.saveTimeEntry(entry);
    this.activeEntry.set(entry);
    this.status.set('active');
    this.pausedForIdle.set(false);

    this.startTicker();
  }

  async clockOut(): Promise<TimeEntry | null> {
    const entry = this.activeEntry();
    if (!entry) return null;

    this.stopTicker();
    const now = Date.now();
    const before = { ...entry };

    // Finalize duration and earnings
    // Clocking out while paused: the paused stretch isn't work, so use the time frozen at the pause
    const wasPaused = entry.status === 'paused';
    const finalDuration = wasPaused ? entry.durationSeconds : this.wallElapsedSeconds();
    if (wasPaused) {
      // Same fallback as resume(): if the page was reloaded while paused, the in-memory
      // currentPause is gone, but the pause record in the database is still open and
      // needs to be closed here too — otherwise it stays open forever.
      let openPause = this.currentPause();
      if (!openPause) {
        const open = (await this.db.getPauses(entry.id).catch(() => [] as TimePause[])).filter((p) => !p.endedAt);
        openPause = open[open.length - 1] ?? null;
      }
      if (openPause) {
        openPause.endedAt = now;
        this.db.savePause(openPause).catch(() => {});
        this.currentPause.set(null);
      }
    }
    entry.durationSeconds = finalDuration;
    entry.endTime = now;
    entry.status = 'completed';
    entry.totalPay = parseFloat(((finalDuration / 3600) * entry.hourlyRate).toFixed(2));
    delete entry.lastPauseTime;

    try {
      await this.db.saveTimeEntry(entry);
    } catch (e) {
      // Not saved — keep the timer going so no time is lost, and let the caller retry
      Object.assign(entry, before);
      if (!('lastPauseTime' in before)) delete entry.lastPauseTime;
      delete entry.endTime;
      if (before.status === 'active') this.startTicker();
      throw e;
    }

    // Stop screen capture
    this.screenshotService.stopScreenCapture();

    // Reset state
    this.activeEntry.set(null);
    this.status.set('completed');
    this.elapsedSeconds.set(0);
    this.pausedSeconds.set(0);
    this.pausedForIdle.set(false);
    this.currentSessionScreenshots.set([]);

    await this.loadTodayEntries();

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
      };

      await this.db.saveScreenshot(ssRecord);

      // Update entry screenshot count
      entry.screenshotCount = (entry.screenshotCount || 0) + 1;
      await this.db.saveTimeEntry(entry);
      this.activeEntry.set({ ...entry });

      // Update session screenshots signal
      this.currentSessionScreenshots.update((list) => [ssRecord, ...list]);

      // Reset countdown
      this.nextScreenshotSeconds.set(this.intervalMinutes * 60);


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

  private lastPersistedSeconds = 0;

  /** Seconds worked so far: wall-clock time since start, minus time spent paused. */
  private wallElapsedSeconds(): number {
    const entry = this.activeEntry();
    if (!entry) return this.elapsedSeconds();
    const wall = Math.floor((Date.now() - entry.startTime) / 1000) - (entry.pausedSeconds || 0);
    return Math.max(0, wall);
  }

  private startTicker(): void {
    this.stopTicker();
    this.lastPersistedSeconds = this.elapsedSeconds();
    this.tickerIntervalId = setInterval(async () => {
      if (this.status() === 'active') {
        // Real clock, not "+1 per tick": browsers throttle or freeze timers in
        // background tabs and during sleep, which made long sessions come up short.
        const nextElapsed = this.wallElapsedSeconds();
        this.elapsedSeconds.set(nextElapsed);

        // Persist the current duration about every 30 seconds
        if (nextElapsed - this.lastPersistedSeconds >= 30 && this.activeEntry()) {
          this.lastPersistedSeconds = nextElapsed;
          const entry = this.activeEntry()!;
          entry.durationSeconds = nextElapsed;
          entry.totalPay = (nextElapsed / 3600) * entry.hourlyRate;
          this.db.saveTimeEntry(entry).catch(() => {});
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
