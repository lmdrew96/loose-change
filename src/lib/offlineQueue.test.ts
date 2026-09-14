import { describe, expect, test } from "vitest";
import { isStuck, STUCK_AFTER_ATTEMPTS, type PendingCapture } from "./offlineQueue";

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
