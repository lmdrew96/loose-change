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

const DAY_MS = 24 * 60 * 60 * 1000;
const DISCARD_WINDOW_MS = 30 * DAY_MS;
// When convex/crons.ts runs purgeExpiredDiscards. An entry isn't gone the
// instant its 30 days are up — it goes at the first run after that.
const PURGE_HOUR_UTC = 8;
const PURGE_MINUTE_UTC = 15;

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** First purge run at or after the moment a discard's 30 days are up. */
export const discardPurgeTime = (discardedAt: number): number => {
  const expiresAt = discardedAt + DISCARD_WINDOW_MS;
  const run = new Date(expiresAt);
  run.setUTCHours(PURGE_HOUR_UTC, PURGE_MINUTE_UTC, 0, 0);
  if (run.getTime() < expiresAt) run.setUTCDate(run.getUTCDate() + 1);
  return run.getTime();
};

/**
 * "Gone for good in 12 days", counted in local calendar days — so it ticks
 * over at the user's midnight, not UTC's, and a DST day (23 or 25 hours)
 * still counts as one.
 */
export const discardCountdown = (discardedAt: number, now: number): string => {
  const days = Math.round((startOfLocalDay(discardPurgeTime(discardedAt)) - startOfLocalDay(now)) / DAY_MS);
  if (days <= 0) return "Gone for good today";
  if (days === 1) return "Gone for good tomorrow";
  return `Gone for good in ${days} days`;
};
