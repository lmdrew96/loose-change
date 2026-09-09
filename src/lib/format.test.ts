import { describe, expect, test } from "vitest";
import { formatCount } from "./format";

describe("formatCount", () => {
  test("renders a plain count", () => {
    expect(formatCount({ count: 4, capped: false })).toBe("4");
  });

  test("marks a capped count", () => {
    expect(formatCount({ count: 500, capped: true })).toBe("500+");
  });

  test("tolerates the pre-cap bare-number shape", () => {
    // Regression: during a Vercel/Convex deploy skew the client received a
    // number here and rendered the string "undefined" in the nav.
    expect(formatCount(4)).toBe("4");
    expect(formatCount(0)).toBe("0");
  });

  test("renders nothing rather than 'undefined' for an unexpected shape", () => {
    expect(formatCount({} as unknown as { count: number; capped: boolean })).toBe("");
  });
});
