import type { Doc } from "../../convex/_generated/dataModel";

export type EntryStatus = Doc<"entries">["status"];
export type Destination = NonNullable<Doc<"entries">["promotedTo"]>;

/**
 * The one name for each status, used on every screen. The raw values leaked
 * into the UI ("· promoted", "· untriaged") while the tabs said "Sent on" and
 * "Inbox", so the same thing had three names depending on where you looked.
 */
export const STATUS_LABELS: Record<EntryStatus, string> = {
  untriaged: "Inbox",
  kept: "Kept",
  promoted: "Sent on",
  discarded: "Discarded",
};

// Mirrors lc_mark_promoted's destination enum exactly. The first two keep
// their fixed positions in Triage's action grid; the rest live behind a
// disclosure so every destination the MCP tool accepts is reachable in the app.
// `url` is where "Open <App>" goes after a Send — a plain link, since none of
// these apps is known to accept prefilled text (the clipboard is the handoff).
export const DESTINATIONS: readonly { id: Destination; label: string; primary: boolean; url: string }[] = [
  { id: "kindling", label: "Kindling", primary: true, url: "https://kindling.adhdesigns.dev" },
  { id: "controlledchaos", label: "ControlledChaos", primary: true, url: "https://controlledchaos.adhdesigns.dev" },
  { id: "threadnotes", label: "ThreadNotes", primary: false, url: "https://research.adhdesigns.dev" },
  { id: "tangle", label: "Tangle", primary: false, url: "https://tangle.adhdesigns.dev" },
  { id: "chaospatch", label: "ChaosPatch", primary: false, url: "https://chaospatch.adhdesigns.dev" },
];

export const destinationLabel = (id: Destination): string =>
  DESTINATIONS.find((d) => d.id === id)?.label ?? id;

export const destinationUrl = (id: Destination): string | undefined => DESTINATIONS.find((d) => d.id === id)?.url;
