import { Injectable, signal } from '@angular/core';
import { DataService } from './data.service';
import { ScreenshotService } from './screenshot.service';
import { RealtimeService } from './realtime.service';
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
  TimerEvent,
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
  /** True when the current pause was triggered automatically by 4 minutes of
   * no mouse/keyboard activity on the computer, not a manual "Pause Shift"
   * click — so the UI can explain why the timer stopped. Desktop app only;
   * a browser tab has no way to see activity outside itself. */
  readonly pausedForIdle = signal<boolean>(false);
  /** Seconds left before an idle auto-pause actually happens, or null when no warning
   * is showing. Gives a heads-up with a chance to say "still working" instead of just
   * discovering afterward that the timer paused — set a few minutes before the real
   * idle-pause fires, counts down, and clears the moment real activity is seen again
   * or the pause actually happens. */
  readonly idleWarningSecondsLeft = signal<number | null>(null);
  private idleWarningCountdownId: any = null;

  private startIdleWarning(secondsUntilPause: number): void {
    if (this.status() !== 'active') return;
    clearInterval(this.idleWarningCountdownId);
    this.idleWarningSecondsLeft.set(Math.max(1, Math.round(secondsUntilPause)));
    this.idleWarningCountdownId = setInterval(() => {
      const left = (this.idleWarningSecondsLeft() ?? 1) - 1;
      if (left <= 0) {
        clearInterval(this.idleWarningCountdownId);
      }
      this.idleWarningSecondsLeft.set(Math.max(0, left));
    }, 1000);
  }

  private clearIdleWarning(): void {
    clearInterval(this.idleWarningCountdownId);
    this.idleWarningSecondsLeft.set(null);
  }

  /** The "still here" button in the warning banner, and any real activity, call this. */
  stillWorking(): void {
    this.clearIdleWarning();
  }

  /** The pause currently in progress (why the timer is stopped) */
  readonly currentPause = signal<TimePause | null>(null);

  /** True when this device opened an entry that's actively being ticked/saved by a
   * DIFFERENT device right now — so this one shows it read-only instead of also
   * ticking, which used to make two devices silently overwrite each other's numbers
   * every ~30 seconds until whichever saved last "won". */
  readonly trackedElsewhere = signal<boolean>(false);

  /** A random id for this browser/app install, persisted so it's stable across reloads.
   * Used only to tell "is this device the one driving the timer right now" apart from
   * "is some other device driving it" — never sent anywhere beyond our own database. */
  private readonly deviceId: string = (() => {
    try {
      const key = 'auravia_device_id';
      let id = localStorage.getItem(key);
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(key, id);
      }
      return id;
    } catch {
      // Private window / blocked storage — fall back to a per-session id. Worst case,
      // this tab's own reloads look like "another device", which just makes it
      // read-only for itself rather than causing any data loss.
      return 'dev_' + Math.random().toString(36).slice(2, 10);
    }
  })();

  /** A live owner's heartbeat (lastTickAt) older than this is treated as dead —
   * that device's app was closed/crashed, so it's safe to take over automatically. */
  private static readonly OWNER_STALE_MS = 90_000;

  private tickerIntervalId: any = null;
  /** Team Access → "Screenshots" for the person whose timer is running */
  private screenshotsAllowed = true;
  private intervalMinutes = 10;

  /** serverNow() - Date.now() = this. A device's own clock can be wrong (bad timezone,
   * manually changed, just drifted) — every "official" timestamp this service writes
   * (clock-in, pause, resume, clock-out) is anchored to the server's clock via this
   * offset, fetched once per session, rather than trusting Date.now() directly. */
  private serverOffsetMs = 0;
  private serverOffsetReady: Promise<void> | null = null;

  private async ensureServerOffset(): Promise<void> {
    if (!this.serverOffsetReady) {
      this.serverOffsetReady = this.db
        .getServerTime()
        .then((serverTime) => {
          this.serverOffsetMs = serverTime - Date.now();
        })
        .catch(() => {
          // No internet / gate unreachable — fall back to the device's own clock
          // rather than blocking the click. Logged in clockIn/pause/resume anyway,
          // so a wrong device clock still shows up as an outlier in timer_events.
          this.serverOffsetMs = 0;
        });
    }
    await this.serverOffsetReady;
  }

  /** The time to actually write for a clock-in/pause/resume/clock-out — call
   * ensureServerOffset() first (clockIn does this; it's cheap to call again). */
  private serverNow(): number {
    return Date.now() + this.serverOffsetMs;
  }

  constructor(
    private db: DataService,
    private screenshotService: ScreenshotService,
    private realtime: RealtimeService
  ) {
    // The running timer is restored per signed-in person (see restoreActiveSession),
    // so one person never picks up someone else's timer.
    this.loadTodayEntries();
    this.watchIdle();
    void this.ensureServerOffset();
  }

  private watchingEmployeeId: string | null = null;
  private unwatchRealtime: (() => void) | null = null;
  private realtimeDebounce: any = null;

  /**
   * Call once a person is signed in and their timer has been restored, so a
   * pause/resume/clock-out made on another tab or device shows up here right
   * away instead of waiting for the next poll. Safe to call repeatedly —
   * re-subscribing for the same person is a no-op.
   */
  watchLiveUpdates(employeeId: string): void {
    if (this.watchingEmployeeId === employeeId) return;
    this.unwatchRealtime?.();
    this.watchingEmployeeId = employeeId;

    const onChange = () => {
      clearTimeout(this.realtimeDebounce);
      this.realtimeDebounce = setTimeout(() => this.restoreActiveSession(employeeId), 400);
    };
    const unsubEntries = this.realtime.onTimeEntriesChange(onChange);
    const unsubPauses = this.realtime.onTimePausesChange(onChange);
    this.unwatchRealtime = () => {
      unsubEntries();
      unsubPauses();
    };
  }

  /**
   * Activity is seen again after an idle auto-pause. This used to call resume()
   * automatically — the moment a mouse moved, the timer silently started counting
   * again, with no click and no confirmation. That's exactly backwards for a pay
   * tracker: a few seconds of activity (brushing the mouse, glancing at a
   * notification) could resume billing without the person ever deciding to.
   * Now it only clears the "why it's paused" banner; resuming always takes an
   * explicit click, same as any other pause reason.
   */
  private idleEndedWhilePaused(): void {
    if (this.status() !== 'paused') return;
    if (this.currentPause()?.reason !== 'idle') return;
    this.pausedForIdle.set(false);
  }

  /** Auto-pause after 2 minutes away from the keyboard/mouse (desktop app only). */
  private watchIdle(): void {
    const api = (window as any).electronAPI;
    if (!api?.isElectron) {
      this.watchIdleInBrowser();
      return;
    }

    api.onIdleWarning((data: { secondsUntilPause: number }) => {
      this.startIdleWarning(data?.secondsUntilPause ?? 60);
    });

    api.onIdleWarningCancelled(() => {
      this.clearIdleWarning();
    });

    api.onIdleStarted(() => {
      this.clearIdleWarning();
      if (this.status() === 'active') {
        this.pausedForIdle.set(true);
        this.pause('idle');
      }
    });

    api.onIdleEnded(() => {
      this.clearIdleWarning();
      this.idleEndedWhilePaused();
    });
  }

  /**
   * Website version: pause after 4 minutes with no activity and show a system
   * notification that brings them back. Uses Chrome's Idle Detection API when
   * allowed (sees the whole computer); otherwise falls back to activity inside
   * this tab, and only while the tab is visible — a hidden tab can't tell
   * "away" from "working in another app".
   */
  private watchIdleInBrowser(): void {
    const IDLE_SECONDS = 240;
    // A heads-up before the real pause — see startIdleWarning()'s doc comment.
    const WARNING_SECONDS = 180;
    let lastActivity = Date.now();
    const touch = () => {
      lastActivity = Date.now();
      this.clearIdleWarning();
      this.idleEndedWhilePaused();
    };
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel']) {
      window.addEventListener(ev, touch, { passive: true });
    }

    const goIdle = (awaySeconds: number) => {
      if (this.status() !== 'active') return;
      this.clearIdleWarning();
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
          else {
            this.clearIdleWarning();
            this.idleEndedWhilePaused();
          }
        });
        await detector.start({ threshold: IDLE_SECONDS * 1000 });
        this.systemIdleWatching = true;
      } catch {
        // Not allowed or unsupported — the in-tab fallback below still runs.
      }
    };

    // Runs regardless of whether the system-wide detector is active, so the warning
    // shows consistently from in-tab activity even when system-wide watching is on.
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const idleFor = Math.floor((Date.now() - lastActivity) / 1000);
      if (this.systemIdleWatching && idleFor < IDLE_SECONDS) return; // let the detector decide the actual pause
      if (idleFor >= IDLE_SECONDS) goIdle(idleFor);
      else if (idleFor >= WARNING_SECONDS) this.startIdleWarning(IDLE_SECONDS - idleFor);
    }, 5000);
  }

  private systemIdleWatching = false;
  private startSystemIdle: () => Promise<void> = async () => {};

  private notifyIdle(): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification('Your timer was paused', {
      body: "No activity for 4 minutes. Click Resume Shift in the app when you're ready to continue.",
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
  private lastRestoredEmployeeId: string | null = null;

  async restoreActiveSession(employeeId: string): Promise<void> {
    // Only hard-reset the display when a DIFFERENT person is loading on this
    // device (so one person never sees another's leftover timer). Doing this
    // unconditionally used to flash the running timer to 00:00 for a moment
    // every single time this component remounted — e.g. switching to another
    // tab and back — even though nothing had actually changed. For the same
    // person, just keep showing what's already on screen until the fresh
    // read below confirms (or corrects) it.
    const isSamePerson = employeeId === this.lastRestoredEmployeeId;
    this.lastRestoredEmployeeId = employeeId;
    if (!isSamePerson) {
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
      this.trackedElsewhere.set(false);
    }

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
        const now = this.serverNow();
        let totalElapsed = active.durationSeconds;
        let paused = active.pausedSeconds;

        if (active.status === 'active') {
          // If was active when closed/refreshed, compute elapsed since startTime minus paused
          const wallClockSeconds = Math.max(0, Math.floor((now - active.startTime) / 1000));
          totalElapsed = Math.max(active.durationSeconds, wallClockSeconds - paused);

          // Is a DIFFERENT device already ticking this entry right now? If its last
          // heartbeat is recent, it's genuinely live — don't also tick here, or the
          // two devices just silently overwrite each other's numbers every ~30s
          // (this is exactly what happened when the same account was open on two
          // devices: one showed 57:04, the other 19:41, each one "winning" in turns).
          const ownedByOther = !!active.ownerDeviceId && active.ownerDeviceId !== this.deviceId;
          const otherIsLive = ownedByOther && now - (active.lastTickAt ?? 0) < TimerService.OWNER_STALE_MS;

          if (otherIsLive) {
            // Someone else (possibly even a "Take over" on another device) now owns
            // it — stop ticking here immediately rather than waiting for this
            // device's own next 30-second checkpoint to notice.
            this.stopTicker();
            this.trackedElsewhere.set(true);
          } else if (this.tickerIntervalId && active.ownerDeviceId === this.deviceId) {
            // Already ours and already ticking — this call is just a realtime notification
            // (e.g. this same entry's own heartbeat landing, or someone else's unrelated
            // entry changing). Restarting the ticker here would reset its 30-second save
            // window every time, so the duration would never actually get persisted.
            this.trackedElsewhere.set(false);
          } else {
            // No live owner elsewhere, and we're not already ticking — claim it and start.
            this.trackedElsewhere.set(false);
            active.ownerDeviceId = this.deviceId;
            active.lastTickAt = now;
            this.db.saveTimeEntry(active).catch(() => {});
            this.startTicker();
          }
        } else if (active.status === 'paused' && active.lastPauseTime) {
          // Add extra paused time while page was away
          // Display only — resume() adds the full paused stretch once; saving it here as well
          // counted the same pause twice.
          paused += Math.max(0, Math.floor((now - active.lastPauseTime) / 1000));

          // Restore *why* it's paused — without this, a reload while on a
          // manually chosen pause (Break, Meeting, etc.) forgot the reason,
          // and the very next mouse move auto-resumed it as if it had been
          // an idle auto-pause, silently overriding the manual pause.
          const open = (await this.db.getPauses(active.id).catch(() => [] as TimePause[])).filter((p) => !p.endedAt);
          this.currentPause.set(open[open.length - 1] ?? null);
        }

        this.elapsedSeconds.set(totalElapsed);
        this.pausedSeconds.set(paused);

        // Load screenshots for this session
        const screenshots = await this.db.getScreenshots(active.id);
        this.currentSessionScreenshots.set(screenshots);
      } else if (isSamePerson) {
        // No active entry after all (e.g. clocked out from another device) —
        // the reset at the top was skipped for this same person, so clear it
        // here instead, now that we actually know there's nothing running.
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
        this.trackedElsewhere.set(false);
      }
    } catch (e) {
      console.error('Failed to restore active time session:', e);
    }
  }

  /** Explicitly claim the running timer on THIS device, even though another device's
   * heartbeat still looks live (e.g. that other device is unreachable — closed laptop,
   * phone with no signal — not actually gone, just not quitting cleanly). A normal stale
   * handover (owner's app closed) happens automatically on the next restore; this is only
   * for the rarer case of consciously overriding a still-live owner. */
  async takeOverDevice(): Promise<void> {
    const entry = this.activeEntry();
    if (!entry) return;
    entry.ownerDeviceId = this.deviceId;
    entry.lastTickAt = this.serverNow();
    await this.db.saveTimeEntry(entry).catch(() => {});
    this.trackedElsewhere.set(false);
    if (entry.status === 'active') this.startTicker();
  }

  /** Appends one line to this entry's permanent history. Never awaited by callers —
   * a dropped log line should never hold up or fail the actual clock action. */
  private logEvent(entry: TimeEntry, action: TimerEvent['action'], reason: PauseReason | undefined, at: number): void {
    const event: TimerEvent = {
      id: 'tevt_' + at + '_' + Math.random().toString(36).substring(2, 7),
      timeEntryId: entry.id,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      action,
      reason,
      clientId: entry.clientId,
      clientName: entry.clientName,
      occurredAt: at,
      deviceId: this.deviceId,
    };
    this.db.saveTimerEvent(event).catch(() => {});
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
    // One round trip for all four reads, not four separate ones.
    const { existing, contracts, settings, permissions } = await this.db.getClockInBootstrap(employee.id);
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

    await this.ensureServerOffset();
    const now = this.serverNow();
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
      ownerDeviceId: this.deviceId,
      lastTickAt: now,
    };

    try {
      await this.db.saveTimeEntry(newEntry);
    } catch (e) {
      // The database refuses a second open timer for the same person (a safety net for
      // the rare case where two clock-ins land at nearly the same instant and both pass
      // the "existing" check above before either one has saved). Someone already won —
      // just pick up whichever session actually got created instead of showing an error.
      if (String((e as any)?.message ?? e).toLowerCase().includes('duplicate key')) {
        await this.restoreActiveSession(employee.id);
        return false;
      }
      throw e;
    }
    this.activeEntry.set(newEntry);
    this.status.set('active');
    this.elapsedSeconds.set(0);
    this.pausedSeconds.set(0);
    this.trackedElsewhere.set(false);
    this.nextScreenshotSeconds.set(this.intervalMinutes * 60);
    this.currentSessionScreenshots.set([]);

    this.startTicker();
    this.logEvent(newEntry, 'start', undefined, now);

    // Trigger an initial capture 2 seconds in to verify capture is working
    setTimeout(() => {
      if (this.status() === 'active') {
        this.captureScreenshot();
      }
    }, 2000);

    return true;
  }

  /** Guards pause()/resume() against a second call landing while the first is still
   * being saved (a double-click, or the system-wide IdleDetector and the in-tab
   * fallback both firing within the same moment). Deliberately separate from
   * `status` — `status` only changes once the database has actually confirmed the
   * change, so the screen never claims "Paused" (or "Active") before it's real. If
   * the save fails partway (connection drops, etc.), the UI simply never moved, no
   * rollback needed — the old approach flipped the screen first and hoped the save
   * would land, which could leave someone staring at "Paused" for a save that failed
   * and a database that still said "Active" the next time it was checked. */
  readonly pauseResumeInFlight = signal(false);

  /** `awaySeconds`: how long the person was already idle — that stretch isn't counted as work. */
  async pause(reason: PauseReason = 'other', awaySeconds = 0): Promise<void> {
    const entry = this.activeEntry();
    if (!entry || this.status() !== 'active' || this.pauseResumeInFlight()) return;
    this.clearIdleWarning();
    this.pauseResumeInFlight.set(true);

    try {
      await this.ensureServerOffset();
      const now = this.serverNow() - awaySeconds * 1000;

      const updated: TimeEntry = {
        ...entry,
        status: 'paused',
        lastPauseTime: now,
        durationSeconds: Math.max(0, this.wallElapsedSeconds() - awaySeconds),
      };
      updated.totalPay = (updated.durationSeconds / 3600) * updated.hourlyRate;

      const pause: TimePause = {
        id: 'pause_' + now + '_' + Math.random().toString(36).substring(2, 6),
        timeEntryId: entry.id,
        employeeId: entry.employeeId,
        reason,
        paid: PAUSE_REASONS.find((r) => r.key === reason)?.paid ?? false,
        startedAt: now,
      };

      // Stop heartbeats first so none can land after (and overwrite) the paused save.
      this.stopTicker();
      try {
        // Only once the database confirms this did the screen ever say "Paused".
        // The pause row is awaited too, so a realtime restore can't run before it exists
        // and wipe the pause reason.
        await Promise.all([this.db.saveTimeEntry(updated), this.db.savePause(pause).catch(() => {})]);
      } catch (e) {
        this.startTicker();
        throw e;
      }

      this.currentPause.set(pause);
      this.activeEntry.set(updated);
      this.status.set('paused');
      this.logEvent(updated, 'pause', reason, now);
    } finally {
      this.pauseResumeInFlight.set(false);
    }
  }

  async resume(): Promise<void> {
    const entry = this.activeEntry();
    if (!entry || this.status() !== 'paused' || this.pauseResumeInFlight()) return;
    this.pauseResumeInFlight.set(true);

    try {
      await this.ensureServerOffset();
      const now = this.serverNow();
      let pause = this.currentPause();
      if (!pause) {
        const open = (await this.db.getPauses(entry.id).catch(() => [] as TimePause[])).filter((p) => !p.endedAt);
        pause = open[open.length - 1] ?? null;
      }

      const updated: TimeEntry = { ...entry };
      // Paid pauses (meetings, technical problems) still count as work
      if (updated.lastPauseTime && !pause?.paid) {
        const addedPaused = Math.max(0, Math.floor((now - updated.lastPauseTime) / 1000));
        updated.pausedSeconds = (updated.pausedSeconds || 0) + addedPaused;
        delete updated.lastPauseTime;
      } else {
        delete updated.lastPauseTime;
      }
      updated.status = 'active';
      // Clicking Resume here is a deliberate action on this device — it becomes the driver.
      updated.ownerDeviceId = this.deviceId;
      updated.lastTickAt = now;

      // Only once the database confirms this did the screen ever say "Active" again.
      await this.db.saveTimeEntry(updated);
      if (pause) {
        pause.endedAt = now;
        this.db.savePause(pause).catch(() => {});
      }

      this.currentPause.set(null);
      this.pausedSeconds.set(updated.pausedSeconds);
      this.activeEntry.set(updated);
      this.status.set('active');
      this.pausedForIdle.set(false);
      this.trackedElsewhere.set(false);

      this.startTicker();
      this.logEvent(updated, 'resume', undefined, now);
    } finally {
      this.pauseResumeInFlight.set(false);
    }
  }

  async clockOut(): Promise<TimeEntry | null> {
    const entry = this.activeEntry();
    if (!entry) return null;

    this.clearIdleWarning();
    this.stopTicker();
    await this.ensureServerOffset();
    const now = this.serverNow();
    const before = { ...entry };

    // Finalize duration and earnings
    // Clocking out while paused: an unpaid pause (break, idle, etc.) isn't work, so use the
    // time frozen at the pause. A PAID pause (meeting, technical problem) still counts as
    // work all the way through — clocking out straight from one without clicking Resume
    // first used to silently drop that paid stretch from both the hours and the pay.
    const wasPaused = entry.status === 'paused';
    let finalDuration = wasPaused ? entry.durationSeconds : this.wallElapsedSeconds();
    if (wasPaused) {
      // Same fallback as resume(): if the page was reloaded while paused, the in-memory
      // currentPause is gone, but the pause record in the database is still open and
      // needs to be closed here too — otherwise it stays open forever.
      let openPause = this.currentPause();
      if (!openPause) {
        const open = (await this.db.getPauses(entry.id).catch(() => [] as TimePause[])).filter((p) => !p.endedAt);
        openPause = open[open.length - 1] ?? null;
      }
      if (openPause?.paid && entry.lastPauseTime) {
        finalDuration += Math.max(0, Math.floor((now - entry.lastPauseTime) / 1000));
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
    this.logEvent(entry, 'stop', undefined, now);

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
    if (!entry) return null;

    // Re-check the live permission right before capturing — screenshotsAllowed
    // was only set at clock-in, so an admin turning it off mid-session had no
    // effect until the person clocked out and back in.
    try {
      const me = await this.db.getEmployeeById(entry.employeeId);
      this.screenshotsAllowed = effectivePermissions(await this.db.getPermissions(), me).screenshots;
    } catch {}
    if (!this.screenshotsAllowed) return null;

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
    const wall = Math.floor((this.serverNow() - entry.startTime) / 1000) - (entry.pausedSeconds || 0);
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
          const entryId = this.activeEntry()!.id;

          // Before writing, make sure nobody else took over since our last tick — without
          // this check, two devices that both believe they own the entry would just hand
          // ownership back and forth every 30 seconds forever instead of one backing off.
          const latest = await this.db.getTimeEntryById(entryId).catch(() => null);
          // Paused/clocked out while that read was in flight — saving now would write the
          // stale "active" entry over the pause and make it snap back.
          const entry = this.activeEntry();
          if (this.status() !== 'active' || this.pauseResumeInFlight() || !entry || entry.id !== entryId) return;
          if (
            latest &&
            latest.ownerDeviceId &&
            latest.ownerDeviceId !== this.deviceId &&
            (latest.lastTickAt ?? 0) > (entry.lastTickAt ?? 0)
          ) {
            this.stopTicker();
            this.trackedElsewhere.set(true);
            return;
          }

          entry.durationSeconds = nextElapsed;
          entry.totalPay = (nextElapsed / 3600) * entry.hourlyRate;
          // Heartbeat: proves THIS device is the live one, so another device
          // that's also open stays read-only instead of ticking in parallel.
          entry.ownerDeviceId = this.deviceId;
          entry.lastTickAt = this.serverNow();
          this.activeEntry.set({ ...entry });
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
