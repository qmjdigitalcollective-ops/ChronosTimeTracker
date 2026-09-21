export type UserRole = 'admin' | 'user';

export type EntryStatus = 'active' | 'paused' | 'completed';

export type SyncStatus = 'synced' | 'pending' | 'failed';

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
  imageDataUrl: string; // base64 JPEG
  thumbnailDataUrl?: string;
  driveFileId?: string;
  driveViewUrl?: string;
  synced: boolean;
  syncedAt?: number;
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
  syncStatus: SyncStatus;
  syncedAt?: number;
  lastSyncError?: string;
  lastPauseTime?: number; // Epoch ms when paused
}

export interface AppSettings {
  screenshotIntervalMinutes: number; // default 10
  autoSync: boolean;
  adminPin: string; // Default 'admin123'
  activeEmployeeId?: string;
  activeRole?: UserRole;
  lastSyncTime?: number;
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
