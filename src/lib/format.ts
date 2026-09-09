/** Count queries cap their scan (see COUNT_CAP in convex/entries.ts) and flag
 *  when they hit it, so the UI can say "500+" instead of reporting a wrong
 *  exact number. */
export const formatCount = ({ count, capped }: { count: number; capped: boolean }): string =>
  capped ? `${count}+` : String(count);

/** Shared across every screen that lists entries, so a timestamp reads the
 *  same everywhere. */
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatTimestamp = (ms: number): string => timestampFormatter.format(ms);
