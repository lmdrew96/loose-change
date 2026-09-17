import { afterEach, describe, expect, test } from "vitest";
import { discardCountdown, discardPurgeTime } from "./format";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const at = (iso: string) => Date.parse(iso);

describe("discardPurgeTime", () => {
  test("is the first 08:15 UTC purge run after the 30 days are up", () => {
    expect(discardPurgeTime(at("2026-03-01T12:00:00Z"))).toBe(at("2026-04-01T08:15:00Z"));
    expect(discardPurgeTime(at("2026-03-01T06:00:00Z"))).toBe(at("2026-03-31T08:15:00Z"));
  });

  test("an expiry exactly at run time is purged by that run", () => {
    expect(discardPurgeTime(at("2026-03-01T08:15:00Z"))).toBe(at("2026-03-31T08:15:00Z"));
  });
});

describe("discardCountdown in New York", () => {
  const discardedAt = at("2026-03-01T12:00:00Z"); // purged 2026-04-01 04:15 EDT

  test("counts local days, not UTC days", () => {
    process.env.TZ = "America/New_York";
    // 23:00 EDT on Mar 29 — already Mar 30 in UTC.
    expect(discardCountdown(discardedAt, at("2026-03-30T03:00:00Z"))).toBe("Gone for good in 3 days");
  });

  test("the day before is tomorrow, and the purge day is today", () => {
    process.env.TZ = "America/New_York";
    expect(discardCountdown(discardedAt, at("2026-03-31T20:00:00Z"))).toBe("Gone for good tomorrow");
    expect(discardCountdown(discardedAt, at("2026-04-01T05:00:00Z"))).toBe("Gone for good today");
  });

  test("an overdue purge (cron hasn't run yet) still reads today", () => {
    process.env.TZ = "America/New_York";
    expect(discardCountdown(discardedAt, at("2026-04-02T12:00:00Z"))).toBe("Gone for good today");
  });

  test("a DST change in between doesn't lose or add a day", () => {
    process.env.TZ = "America/New_York";
    // Clocks go forward 2026-03-08. Purge run: 2026-03-13 08:15Z = 04:15 EDT.
    expect(discardCountdown(at("2026-02-10T12:00:00Z"), at("2026-03-07T17:00:00Z"))).toBe(
      "Gone for good in 6 days",
    );
  });
});

describe("discardCountdown in Tokyo", () => {
  test("a purge that's tomorrow in UTC terms can be today locally", () => {
    process.env.TZ = "Asia/Tokyo";
    // Purge 2026-04-01 17:15 JST; now is 2026-04-01 01:00 JST.
    expect(discardCountdown(at("2026-03-01T12:00:00Z"), at("2026-03-31T16:00:00Z"))).toBe(
      "Gone for good today",
    );
  });
});
