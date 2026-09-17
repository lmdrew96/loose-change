import { describe, expect, test } from "vitest";
import {
  LEGACY_SCHEDULE,
  inTimeZone,
  isReminderDue,
  nextReminderAt,
  resolveSchedule,
  type ReminderSchedule,
} from "./reminderSchedule";

const at = (iso: string) => Date.parse(iso);
const NY_SUNDAY_10: ReminderSchedule = { frequency: "weekly", dayOfWeek: 0, hour: 10, timeZone: "America/New_York" };

describe("weekly reminders in New York (UTC-4 in September)", () => {
  test("due from the set local hour, not the UTC one", () => {
    // 2026-09-20 is a Sunday.
    expect(isReminderDue(NY_SUNDAY_10, undefined, at("2026-09-20T13:00:00Z"))).toBe(false); // 09:00
    expect(isReminderDue(NY_SUNDAY_10, undefined, at("2026-09-20T14:00:00Z"))).toBe(true); // 10:00
  });

  test("stays due for the window, then stops", () => {
    expect(isReminderDue(NY_SUNDAY_10, undefined, at("2026-09-20T16:00:00Z"))).toBe(true); // 12:00
    expect(isReminderDue(NY_SUNDAY_10, undefined, at("2026-09-20T17:00:00Z"))).toBe(false); // 13:00
  });

  test("never sends twice on the same local day", () => {
    const sent = at("2026-09-20T14:00:00Z");
    expect(isReminderDue(NY_SUNDAY_10, sent, at("2026-09-20T15:00:00Z"))).toBe(false);
    expect(isReminderDue(NY_SUNDAY_10, sent, sent)).toBe(false);
    expect(isReminderDue(NY_SUNDAY_10, sent, at("2026-09-27T14:00:00Z"))).toBe(true);
  });

  test("the wrong day is never due", () => {
    expect(isReminderDue(NY_SUNDAY_10, undefined, at("2026-09-19T14:00:00Z"))).toBe(false); // Saturday
  });

  test("a local Sunday that is Monday in UTC still counts as Sunday", () => {
    const late = { ...NY_SUNDAY_10, hour: 22 };
    expect(isReminderDue(late, undefined, at("2026-09-21T02:00:00Z"))).toBe(true); // Sun 22:00 EDT
  });
});

describe("weekly reminders in Tokyo (UTC+9)", () => {
  const TOKYO_MONDAY_9: ReminderSchedule = { frequency: "weekly", dayOfWeek: 1, hour: 9, timeZone: "Asia/Tokyo" };

  test("Monday 09:00 JST is Sunday in UTC", () => {
    expect(isReminderDue(TOKYO_MONDAY_9, undefined, at("2026-09-21T00:00:00Z"))).toBe(true);
    expect(isReminderDue(TOKYO_MONDAY_9, undefined, at("2026-09-20T00:00:00Z"))).toBe(false); // Sunday JST
  });
});

describe("DST transitions (America/New_York)", () => {
  test("a local hour skipped when clocks go forward is still sent that day", () => {
    // 2026-03-08: 02:00 doesn't exist. 07:00Z is 03:00 EDT, inside the window.
    const twoAm = { ...NY_SUNDAY_10, hour: 2 };
    expect(isReminderDue(twoAm, undefined, at("2026-03-08T07:00:00Z"))).toBe(true);
  });

  test("a local hour that happens twice when clocks go back sends once", () => {
    // 2026-11-01: 01:00 EDT (05:00Z) and 01:00 EST (06:00Z).
    const oneAm = { ...NY_SUNDAY_10, hour: 1 };
    expect(isReminderDue(oneAm, undefined, at("2026-11-01T05:00:00Z"))).toBe(true);
    expect(isReminderDue(oneAm, at("2026-11-01T05:00:00Z"), at("2026-11-01T06:00:00Z"))).toBe(false);
  });

  test("the local time holds across the change — no hour of drift", () => {
    // 10:00 local is 14:00Z before the change and 15:00Z after it.
    expect(isReminderDue(NY_SUNDAY_10, undefined, at("2026-11-08T15:00:00Z"))).toBe(true);
    expect(isReminderDue(NY_SUNDAY_10, undefined, at("2026-11-08T14:00:00Z"))).toBe(false);
  });
});

describe("every 3 days", () => {
  const EVERY3: ReminderSchedule = { frequency: "every3days", dayOfWeek: 0, hour: 9, timeZone: "America/New_York" };
  const sent = at("2026-09-17T13:00:00Z"); // Thu 09:00 EDT

  test("waits three local days", () => {
    expect(isReminderDue(EVERY3, sent, at("2026-09-19T13:00:00Z"))).toBe(false);
    expect(isReminderDue(EVERY3, sent, at("2026-09-20T13:00:00Z"))).toBe(true);
  });

  test("ignores the day of the week", () => {
    expect(isReminderDue(EVERY3, undefined, at("2026-09-17T13:00:00Z"))).toBe(true);
  });
});

describe("legacy subscriptions", () => {
  test("nothing stored means exactly the old Sunday 16:00 UTC", () => {
    expect(resolveSchedule({})).toEqual(LEGACY_SCHEDULE);
    expect(isReminderDue(LEGACY_SCHEDULE, undefined, at("2026-09-20T16:00:00Z"))).toBe(true);
    expect(isReminderDue(LEGACY_SCHEDULE, undefined, at("2026-09-20T15:00:00Z"))).toBe(false);
  });

  test("a stored day and hour without a timezone aren't trusted", () => {
    expect(resolveSchedule({ dayOfWeek: 3, hour: 7 })).toEqual(LEGACY_SCHEDULE);
  });

  test("shown in the device's timezone as the same moment", () => {
    // Sunday 16:00 UTC is Sunday 12:00 in New York in September.
    const shown = inTimeZone(LEGACY_SCHEDULE, "America/New_York", at("2026-09-17T12:00:00Z"));
    expect(shown).toEqual({ frequency: "weekly", dayOfWeek: 0, hour: 12, timeZone: "America/New_York" });
  });
});

describe("nextReminderAt", () => {
  test("finds the next sending run", () => {
    expect(nextReminderAt(NY_SUNDAY_10, undefined, at("2026-09-17T12:30:00Z"))).toBe(at("2026-09-20T14:00:00Z"));
  });

  test("skips today once it has been sent", () => {
    const sent = at("2026-09-20T14:00:00Z");
    expect(nextReminderAt(NY_SUNDAY_10, sent, at("2026-09-20T14:05:00Z"))).toBe(at("2026-09-27T14:00:00Z"));
  });
});
