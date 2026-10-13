// Run: deno test supabase/functions/gate/report_test.ts
// Checks the read-only payroll report: pay-period maths in Philippine time, the key
// comparison, and that the summary only counts what it should and leaks nothing extra.
(Deno as any).serve = () => {}; // importing index.ts must not start a server
const { payPeriodContaining, previousPayPeriod, periodBoundsMs, safeEqual, buildPayrollReport } = await import("./index.ts");

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

Deno.test("pay periods are the 1st-15th and 16th-end of month", () => {
  eq(payPeriodContaining(2026, 10, 1), { start: "2026-10-01", end: "2026-10-15" });
  eq(payPeriodContaining(2026, 10, 15), { start: "2026-10-01", end: "2026-10-15" });
  eq(payPeriodContaining(2026, 10, 16), { start: "2026-10-16", end: "2026-10-31" });
  eq(payPeriodContaining(2026, 9, 20), { start: "2026-09-16", end: "2026-09-30" });
  eq(payPeriodContaining(2028, 2, 20), { start: "2028-02-16", end: "2028-02-29" }); // leap year
});

Deno.test("previous period crosses month and year boundaries", () => {
  eq(previousPayPeriod(2026, 10, 3), { start: "2026-09-16", end: "2026-09-30" });
  eq(previousPayPeriod(2026, 10, 20), { start: "2026-10-01", end: "2026-10-15" });
  eq(previousPayPeriod(2027, 1, 5), { start: "2026-12-16", end: "2026-12-31" });
});

Deno.test("period bounds are Manila midnight to the last millisecond of the end day", () => {
  const { startMs, endMs } = periodBoundsMs("2026-10-01", "2026-10-15");
  eq(new Date(startMs).toISOString(), "2026-09-30T16:00:00.000Z"); // Oct 1 00:00 in UTC+8
  eq(new Date(endMs).toISOString(), "2026-10-15T15:59:59.999Z"); // Oct 15 23:59:59.999 in UTC+8
});

Deno.test("key check rejects wrong, short and empty keys", () => {
  eq(safeEqual("a".repeat(40), "a".repeat(40)), true);
  eq(safeEqual("a".repeat(40), "a".repeat(39) + "b"), false);
  eq(safeEqual("short", "a".repeat(40)), false);
  eq(safeEqual("", "a".repeat(40)), false);
});

Deno.test("report counts completed approved entries, flags the rest, and exposes no private fields", () => {
  const startMs = periodBoundsMs("2026-10-01", "2026-10-15").startMs;
  const r = buildPayrollReport({
    employees: [{ id: "e1", name: "Ann" }, { id: "e2", name: "Bea" }, { id: "e3", name: "Idle" }],
    entries: [
      { employee_id: "e1", status: "completed", duration_seconds: 3600, total_pay: 90, approval_status: null },
      { employee_id: "e1", status: "completed", duration_seconds: 1800, total_pay: 45, approval_status: "approved" },
      { employee_id: "e1", status: "completed", duration_seconds: 7200, total_pay: 180, approval_status: "pending" },
      { employee_id: "e1", status: "active", duration_seconds: 600, total_pay: 15, approval_status: null },
      { employee_id: "e2", status: "completed", duration_seconds: 3600, total_pay: 100, approval_status: null },
    ],
    approvals: [{ employee_id: "e1", status: "approved", period_start: startMs }],
    payouts: [{ employee_id: "e2", amount: 100, paid_at: 1790000000000, period_start: startMs }],
    startMs,
  });
  const ann = r.employees.find((x: any) => x.employeeId === "e1");
  eq(ann.hours, 1.5);
  eq(ann.earnings, 135);
  eq(ann.inProgressEarnings, 15);
  eq(ann.pendingManualEntries, 1);
  eq(ann.timesheetStatus, "approved");
  eq(ann.paid, false);
  const bea = r.employees.find((x: any) => x.employeeId === "e2");
  eq([bea.paid, bea.paidAmount, bea.timesheetStatus], [true, 100, "not_submitted"]);
  eq(r.employees.some((x: any) => x.employeeId === "e3"), false); // no activity -> not listed
  eq(r.totals, { hours: 2.5, earnings: 235, inProgressEarnings: 15, paidAmount: 100 });
  const allowed = ["employeeId", "name", "hours", "earnings", "inProgressEarnings", "pendingManualEntries", "timesheetStatus", "paid", "paidAmount", "paidAt"];
  eq(Object.keys(ann), allowed);
});
