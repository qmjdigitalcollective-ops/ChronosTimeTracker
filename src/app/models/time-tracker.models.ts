export type UserRole = 'admin' | 'user';

export type EntryStatus = 'active' | 'paused' | 'completed';

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  hourlyRate: number; // in USD or local currency
  pin?: string; // Optional employee PIN
  department?: string;
  avatarColor?: string;
  active: boolean;
}

export interface Client {
  id: string;
  name: string;
  code: string;
  defaultRate?: number;
  color?: string;
  active: boolean;
}

export interface ScreenshotRecord {
  id: string;
  timeEntryId: string;
  employeeId: string;
  employeeName: string;
  timestamp: number; // Epoch ms
  imageDataUrl: string; // signed Storage URL once saved; base64 for older rows and fresh local captures
  thumbnailDataUrl?: string;
  driveFileId?: string;
  driveViewUrl?: string;
}

export interface TimeEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  clientId: string;
  clientName: string;
  taskDescription: string;
  startTime: number; // Epoch ms
  endTime?: number; // Epoch ms
  durationSeconds: number; // Active worked seconds
  pausedSeconds: number; // Paused seconds
  status: EntryStatus;
  hourlyRate: number; // Frozen at entry creation
  totalPay: number; // (durationSeconds / 3600) * hourlyRate
  screenshotCount: number;
  lastPauseTime?: number; // Epoch ms when paused
  /** Only set on entries a team member added themselves (not a real clock-in) — needs admin sign-off. */
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  /** Which device's ticker is allowed to actively tick and autosave this entry. */
  ownerDeviceId?: string;
  /** Epoch ms of the owning device's last heartbeat — a second device uses this to tell a
   * live owner (recently ticking) apart from a dead one (owner's app closed/crashed). */
  lastTickAt?: number;
}

/** IDs of team-member-submitted manual entries — distinct from admin's own MANUAL_ENTRY_PREFIX
 * ("manual_") so the gate function can force approvalStatus without touching admin-added rows. */
export const SELF_MANUAL_ENTRY_PREFIX = 'selfmanual_';

export interface AppSettings {
  screenshotIntervalMinutes: number; // default 10
  adminPin: string; // Default 'admin123'
  activeEmployeeId?: string;
  activeRole?: UserRole;
  allowMockScreenshotsIfDenied: boolean;
}

export interface EmployeeReportSummary {
  employeeId: string;
  employeeName: string;
  hourlyRate: number;
  totalEntries: number;
  totalSeconds: number;
  totalHours: number;
  totalPay: number;
  screenshotCount: number;
}

export interface ClientReportSummary {
  clientId: string;
  clientName: string;
  totalEntries: number;
  totalSeconds: number;
  totalHours: number;
  totalCost: number;
}

/**
 * A contract sets the pay and bill rate for one team member on one project/client
 * (same idea as WebWork's Contracts page). If there is no contract, the member's
 * default pay rate and the client's default bill rate are used.
 */
export interface Contract {
  id: string;
  employeeId: string;
  clientId: string;
  payRate: number; // what Auravia pays the member per hour
  billRate: number; // what Auravia charges the client per hour
  weeklyLimitHours?: number;
  active: boolean;
}

/** A record that a team member was paid for a pay period. */
export interface Payout {
  id: string;
  employeeId: string;
  employeeName: string;
  periodStart: number; // Epoch ms (start of first day)
  periodEnd: number; // Epoch ms (start of last day)
  hours: number;
  amount: number;
  paidAt: number; // Epoch ms
  note?: string;
}

export type TimesheetStatus = 'submitted' | 'approved' | 'rejected';

/** A member's timesheet for one pay period: they submit it, an admin approves it. */
export interface TimesheetApproval {
  id: string; // `${employeeId}_${periodStart}`
  employeeId: string;
  employeeName: string;
  periodStart: number; // Epoch ms (start of first day)
  periodEnd: number; // Epoch ms (start of last day)
  status: TimesheetStatus;
  hours: number; // hours when last submitted
  submittedAt: number;
  reviewedAt?: number;
  note?: string; // admin note when sending back
}

/** Manual entries (added through "Add time") get ids starting with this, so they can be told apart. */
export const MANUAL_ENTRY_PREFIX = 'manual_';

/** What a team member (not an admin) can see and do. Admins always have full access. */
export interface MemberPermissions {
  showEarnings: boolean; // see ₱ amounts (session, week, pay period)
  showPayPanel: boolean; // see the "My Pay Period" panel and paid status
  submitTimesheet: boolean; // submit their timesheet for approval
  viewHistory: boolean; // look back at weeks / pay periods / custom dates (off = today only)
  allProjects: boolean; // see every project (off = only projects they have a contract on)
  screenshots: boolean; // take screenshots while their timer runs
}

/** Saved access settings: id 'default' applies to everyone, or an employee id for one person. */
export interface TeamPermissionRow {
  id: string;
  permissions: MemberPermissions;
}

export type PauseReason = 'break' | 'meeting' | 'technical' | 'away' | 'idle' | 'other';

/** Paid pauses still count as work time; unpaid ones are taken off the entry's duration. */
export const PAUSE_REASONS: { key: PauseReason; label: string; paid: boolean }[] = [
  { key: 'break', label: 'Break', paid: false },
  { key: 'meeting', label: 'Meeting / call', paid: true },
  { key: 'technical', label: 'Technical problem', paid: true },
  { key: 'away', label: 'Away', paid: false },
  { key: 'idle', label: 'Idle (automatic)', paid: false },
  { key: 'other', label: 'Other', paid: false },
];

export interface TimePause {
  id: string;
  timeEntryId: string;
  employeeId: string;
  reason: PauseReason;
  paid: boolean;
  startedAt: number;
  endedAt?: number;
}

/** One line in the permanent history of a running timer — never edited after it's
 * written, only ever added to. Lets a pay dispute ("why is my total wrong?") be
 * answered by reading exactly what happened, instead of reverse-engineering it
 * from the final numbers the way Rein's Sep 29 entry had to be investigated. */
export interface TimerEvent {
  id: string;
  timeEntryId: string;
  employeeId: string;
  employeeName: string;
  action: 'start' | 'pause' | 'resume' | 'stop';
  reason?: PauseReason;
  clientId?: string;
  clientName?: string;
  occurredAt: number;
  deviceId?: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface WorkTask {
  id: string;
  employeeId: string | null;
  clientId: string | null;
  clientName: string | null;
  title: string;
  status: TaskStatus;
  source: 'manual' | 'clickup';
  clickupTaskId?: string;
  clickupListId?: string;
  clickupUrl?: string;
  dueDate?: number;
  createdAt: number;
  updatedAt: number;
}
