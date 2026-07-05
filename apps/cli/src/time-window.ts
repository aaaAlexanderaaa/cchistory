/**
 * Parse a --since value (ISO timestamp or relative window like 7d/12h/30m/2w)
 * into a `YYYY-MM-DD` date (local calendar day) suitable for storage filters
 * that compare against `row.day`.
 *
 * The storage layer's `after_date` is date-granularity (`row.day` is the
 * `YYYY-MM-DD` slice of `submission_started_at`), so we collapse to the day
 * component here. Returns undefined when the input is empty so callers can
 * use it as a pass-through. Throws a usageError-shaped Error so the CLI exit
 * code is 2.
 */
export function parseSinceWindow(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const relative = trimmed.match(/^(\d+)(m|h|d|w)$/iu);
  let iso: string;
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const multiplier =
      unit === "m" ? 60_000 :
      unit === "h" ? 60 * 60_000 :
      unit === "d" ? 24 * 60 * 60_000 :
      7 * 24 * 60 * 60_000;
    iso = new Date(Date.now() - amount * multiplier).toISOString();
  } else {
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid --since value: ${value}. Use an ISO timestamp or a relative window such as 30m, 12h, 7d, or 2w.`);
    }
    iso = new Date(parsed).toISOString();
  }
  return localDayOf(new Date(iso));
}

/**
 * Compute the start of the current local day (midnight) as a `YYYY-MM-DD`
 * string. `now` is overridable for tests.
 */
export function startOfToday(now: Date = new Date()): string {
  const copy = new Date(now);
  copy.setHours(0, 0, 0, 0);
  return localDayOf(copy);
}

/**
 * Compute the start of the current ISO week (Monday midnight local) as a
 * `YYYY-MM-DD` string.
 */
export function startOfWeek(now: Date = new Date()): string {
  const copy = new Date(now);
  copy.setHours(0, 0, 0, 0);
  // JS: 0 = Sunday, 1 = Monday. Shift so Monday is the first day.
  const dayOfWeek = copy.getDay();
  const offsetToMonday = (dayOfWeek + 6) % 7; // Sunday(0) -> 6, Monday(1) -> 0
  copy.setDate(copy.getDate() - offsetToMonday);
  return localDayOf(copy);
}

/**
 * Compute the start of the current month (day 1, midnight local) as a
 * `YYYY-MM-DD` string.
 */
export function startOfMonth(now: Date = new Date()): string {
  const copy = new Date(now);
  copy.setDate(1);
  copy.setHours(0, 0, 0, 0);
  return localDayOf(copy);
}

/**
 * Format a Date as a `YYYY-MM-DD` string in the *local* calendar day.
 * `Date.prototype.toISOString()` would give the UTC day, which is wrong for
 * users offset far from UTC; building from local getFullYear/getMonth/getDate
 * keeps "today" aligned with the user's clock.
 */
function localDayOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
