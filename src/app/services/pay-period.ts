/** Pay periods are semi-monthly: the 1st–15th, and the 16th–end of the month. */
export function payPeriodFor(date: Date): [Date, Date] {
  const y = date.getFullYear();
  const m = date.getMonth();
  return date.getDate() <= 15
    ? [new Date(y, m, 1), new Date(y, m, 15)]
    : [new Date(y, m, 16), new Date(y, m + 1, 0)];
}

/** The pay period right before the one containing `date`. */
export function previousPayPeriod(date: Date): [Date, Date] {
  const [start] = payPeriodFor(date);
  return payPeriodFor(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1));
}

export function formatPeriod(start: Date, end: Date): string {
  const s = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const e = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} – ${e}`;
}
