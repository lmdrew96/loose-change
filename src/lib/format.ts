/**
 * Count queries cap their scan (see COUNT_CAP in convex/entries.ts) and flag
 * when they hit it, so the UI can say "500+" instead of reporting a wrong
 * exact number.
 *
 * Accepts a bare number too. Vercel and Convex deploy independently, so there
 * is always a window where the browser runs new client code against older
 * functions — this query returned a plain number before the cap existed, and
 * destructuring one silently produced the string "undefined" in the nav.
 * Degrading to a correct count beats showing the user that.
 */
export const formatCount = (value: { count: number; capped: boolean } | number): string => {
  if (typeof value === "number") return String(value);
  if (typeof value?.count !== "number") return "";
  return value.capped ? `${value.count}+` : String(value.count);
};

/** Shared across every screen that lists entries, so a timestamp reads the
 *  same everywhere. */
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatTimestamp = (ms: number): string => timestampFormatter.format(ms);
