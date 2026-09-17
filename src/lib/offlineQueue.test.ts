import { describe, expect, test } from "vitest";
import {
  belongsToUser,
  isDueForRetry,
  isStuck,
  STUCK_AFTER_ATTEMPTS,
  withOwner,
  type PendingCapture,
} from "./offlineQueue";

const base: PendingCapture = { localId: "a", captureMode: "text", transcript: "x", capturedAt: 0 };

describe("isStuck", () => {
  test("a capture queued before attempt tracking existed is waiting, not stuck", () => {
    expect(isStuck(base)).toBe(false);
  });

  test("stays waiting below the threshold", () => {
    expect(isStuck({ ...base, attempts: STUCK_AFTER_ATTEMPTS - 1 })).toBe(false);
  });

  test("becomes stuck exactly at the threshold", () => {
    expect(isStuck({ ...base, attempts: STUCK_AFTER_ATTEMPTS })).toBe(true);
  });
});

describe("isDueForRetry", () => {
  const now = 10 * 60 * 60_000;

  test("a capture that has never failed is never delayed", () => {
    expect(isDueForRetry(base, now)).toBe(true);
    expect(isDueForRetry({ ...base, lastAttemptAt: now }, now)).toBe(true);
  });

  test("a failure recorded before lastAttemptAt existed isn't delayed", () => {
    expect(isDueForRetry({ ...base, attempts: 3 }, now)).toBe(true);
  });

  test("the first failure waits 30s", () => {
    const capture = { ...base, attempts: 1, lastAttemptAt: now };
    expect(isDueForRetry(capture, now + 29_999)).toBe(false);
    expect(isDueForRetry(capture, now + 30_000)).toBe(true);
  });

  test("the delay doubles per failure", () => {
    const capture = { ...base, attempts: 3, lastAttemptAt: now };
    expect(isDueForRetry(capture, now + 119_999)).toBe(false);
    expect(isDueForRetry(capture, now + 120_000)).toBe(true);
  });

  test("the delay caps at an hour", () => {
    const capture = { ...base, attempts: 50, lastAttemptAt: now };
    expect(isDueForRetry(capture, now + 60 * 60_000 - 1)).toBe(false);
    expect(isDueForRetry(capture, now + 60 * 60_000)).toBe(true);
  });
});

describe("belongsToUser", () => {
  test("a capture only syncs into the account it was made under", () => {
    const mine = { ...base, userId: "user_a" };
    expect(belongsToUser(mine, "user_a")).toBe(true);
    expect(belongsToUser(mine, "user_b")).toBe(false);
  });

  test("a stamped capture isn't shown to nobody-in-particular", () => {
    expect(belongsToUser({ ...base, userId: "user_a" }, null)).toBe(false);
  });

  test("a legacy capture with no owner belongs to whoever is signed in", () => {
    // Queued before ownership existed. Stranding it would lose the memo.
    expect(belongsToUser(base, "user_a")).toBe(true);
    expect(belongsToUser(base, "user_b")).toBe(true);
    expect(belongsToUser(base, null)).toBe(true);
  });
});

describe("withOwner", () => {
  test("stamps an unowned capture", () => {
    expect(withOwner(base, "user_a").userId).toBe("user_a");
  });

  test("never re-stamps a capture that already has an owner", () => {
    // A salvaged recording is finalized under whoever is signed in now, but it
    // still belongs to the account that recorded it.
    expect(withOwner({ ...base, userId: "user_a" }, "user_b").userId).toBe("user_a");
  });

  test("leaves a capture unowned when nobody is known", () => {
    expect(withOwner(base, null).userId).toBeUndefined();
  });
});
