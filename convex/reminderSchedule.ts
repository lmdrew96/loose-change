// When a reminder is due, worked out in the recipient's own timezone.
//
// Pure functions only, no Convex imports: the hourly cron (push.ts, a Node
// action with full timezone data) and the Settings screen ("Next reminder:
// …") both use this. It's deliberately not called from mutations, which run
// in Convex's default runtime.

export type ReminderFrequency = "weekly" | "every3days";

export type ReminderSchedule = {
  frequency: ReminderFrequency;
  /** 0 = Sunday … 6 = Saturday. Ignored for every3days. */
  dayOfWeek: number;
  /** Local hour, 0–23. */
  hour: number;
  /** IANA name, e.g. "America/New_York". */
  timeZone: string;
};

export type StoredSchedule = {
  frequency?: ReminderFrequency;
  dayOfWeek?: number;
  hour?: number;
  timeZone?: string;
};

// What every subscription got before schedules existed: Sunday 16:00 UTC. A
// subscription with nothing stored keeps exactly that until its owner picks
// something else, so nobody's reminder moves unprompted.
export const LEGACY_SCHEDULE: ReminderSchedule = { frequency: "weekly", dayOfWeek: 0, hour: 16, timeZone: "UTC" };

// Default for a new subscription: Sunday morning, device time.
export const DEFAULT_HOUR = 10;

export const EVERY_FEW_DAYS = 3;

// A reminder is sent at the first hourly run inside this many hours from its
// set time. More than one hour so a skipped local hour (clocks going forward)
// or a missed cron run doesn't lose the reminder for the week.
export const DUE_WINDOW_HOURS = 3;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function resolveSchedule(stored: StoredSchedule): ReminderSchedule {
  // Without a timezone the day and hour mean nothing, so they're only trusted
  // together.
  if (!stored.timeZone) return LEGACY_SCHEDULE;
  return {
    frequency: stored.frequency ?? "weekly",
    dayOfWeek: stored.dayOfWeek ?? 0,
    hour: stored.hour ?? DEFAULT_HOUR,
    timeZone: stored.timeZone,
  };
}

type LocalParts = { dayNumber: number; dayOfWeek: number; hour: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The local calendar day (as a day count), weekday and hour of an instant. */
export function localParts(ms: number, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(ms)) parts[type] = value;
  return {
    // A day count rather than a date string, so "three days later" is plain
    // subtraction regardless of month lengths.
    dayNumber: Math.round(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS),
    dayOfWeek: WEEKDAYS.indexOf(parts.weekday),
    hour: Number(parts.hour) % 24,
  };
}

/**
 * Whether an hourly run at `now` should send. At most once per local day for
 * weekly, and at least EVERY_FEW_DAYS local days apart otherwise — which is
 * also what stops a retried or overlapping run from sending twice.
 */
export function isReminderDue(schedule: ReminderSchedule, lastSentAt: number | undefined, now: number): boolean {
  const local = localParts(now, schedule.timeZone);
  if (local.hour < schedule.hour || local.hour >= schedule.hour + DUE_WINDOW_HOURS) return false;

  const last = lastSentAt === undefined ? null : localParts(lastSentAt, schedule.timeZone);
  if (schedule.frequency === "weekly") {
    if (local.dayOfWeek !== schedule.dayOfWeek) return false;
    return last === null || last.dayNumber !== local.dayNumber;
  }
  return last === null || local.dayNumber - last.dayNumber >= EVERY_FEW_DAYS;
}

/** When the next hourly run that sends will happen, or null if none within 8 days. */
export function nextReminderAt(schedule: ReminderSchedule, lastSentAt: number | undefined, now: number): number | null {
  // The cron fires on the hour (UTC), so only those instants are candidates.
  const firstRun = Math.ceil(now / HOUR_MS) * HOUR_MS;
  for (let i = 0; i < 24 * 8; i++) {
    const run = firstRun + i * HOUR_MS;
    if (isReminderDue(schedule, lastSentAt, run)) return run;
  }
  return null;
}

/**
 * The same schedule expressed in another timezone, keyed off its next run —
 * so a legacy Sunday-16:00-UTC reminder shows up in Settings as, say,
 * "Sunday 12:00" on a New York phone rather than as a UTC time.
 */
export function inTimeZone(schedule: ReminderSchedule, timeZone: string, now: number): ReminderSchedule {
  if (schedule.timeZone === timeZone) return schedule;
  const next = nextReminderAt(schedule, undefined, now);
  if (next === null) return { ...schedule, timeZone };
  const local = localParts(next, timeZone);
  return { frequency: schedule.frequency, dayOfWeek: local.dayOfWeek, hour: local.hour, timeZone };
}

// Loose shape check only — real validation needs timezone data, which is
// available where the schedule is used (the Node action), not in mutations.
export const looksLikeTimeZone = (value: string): boolean => /^[A-Za-z0-9_+\-/]{1,64}$/.test(value);
