/** Count queries cap their scan (see COUNT_CAP in convex/entries.ts) and flag
 *  when they hit it, so the UI can say "500+" instead of reporting a wrong
 *  exact number. */
export const formatCount = ({ count, capped }: { count: number; capped: boolean }): string =>
  capped ? `${count}+` : String(count);
