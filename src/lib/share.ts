// Shape of what the OS share sheet hands over (manifest share_target, GET).
// Apps fill these inconsistently: many put the link inside `text`, and the
// title is often just the page title — so repeats are dropped.
export type SharedFields = { title?: string | null; text?: string | null; url?: string | null };

// Query parameter names from manifest.webmanifest's share_target. Prefixed so
// they can't collide with anything else Record reads from the URL.
export const SHARE_PARAMS = { title: "share_title", text: "share_text", url: "share_url" } as const;

/** One transcript from a share, or null if nothing usable was shared. */
export function buildSharedTranscript({ title, text, url }: SharedFields): string | null {
  const t = title?.trim() ?? "";
  const x = text?.trim() ?? "";
  const u = url?.trim() ?? "";

  const parts: string[] = [];
  if (t && !x.includes(t) && t !== u) parts.push(t);
  if (x) parts.push(x);
  if (u && !x.includes(u)) parts.push(u);
  return parts.length > 0 ? parts.join("\n\n") : null;
}
