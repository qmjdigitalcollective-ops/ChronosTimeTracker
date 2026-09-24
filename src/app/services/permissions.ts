import { Employee, MemberPermissions, TeamPermissionRow } from '../models/time-tracker.models';

export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  showEarnings: true,
  showPayPanel: true,
  submitTimesheet: true,
  viewHistory: true,
  allProjects: false,
  screenshots: true,
};

export const PERMISSION_LABELS: { key: keyof MemberPermissions; label: string; hint: string }[] = [
  { key: 'showEarnings', label: 'See earnings', hint: 'Show ₱ amounts to them' },
  { key: 'showPayPanel', label: 'Pay panel', hint: 'My Pay Period and paid status' },
  { key: 'submitTimesheet', label: 'Submit timesheet', hint: 'Send timesheets for approval' },
  { key: 'viewHistory', label: 'Past time', hint: 'Weeks, pay periods, custom dates' },
  { key: 'allProjects', label: 'All projects', hint: 'Off = only their assigned projects' },
  { key: 'screenshots', label: 'Screenshots', hint: 'Capture screenshots while tracking' },
];

/** The access that applies to this person: their own setting, else the "Everyone" setting. */
export function effectivePermissions(rows: TeamPermissionRow[], employee: Employee | null | undefined): MemberPermissions {
  if (employee?.role === 'admin') {
    return { showEarnings: true, showPayPanel: true, submitTimesheet: true, viewHistory: true, allProjects: true, screenshots: true };
  }
  const base = rows.find((r) => r.id === 'default')?.permissions ?? DEFAULT_MEMBER_PERMISSIONS;
  const own = employee ? rows.find((r) => r.id === employee.id)?.permissions : undefined;
  return { ...DEFAULT_MEMBER_PERMISSIONS, ...base, ...(own ?? {}) };
}
