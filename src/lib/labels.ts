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
export const DESTINATIONS: readonly { id: Destination; label: string; primary: boolean }[] = [
  { id: "kindling", label: "Kindling", primary: true },
  { id: "controlledchaos", label: "ControlledChaos", primary: true },
  { id: "threadnotes", label: "ThreadNotes", primary: false },
  { id: "tangle", label: "Tangle", primary: false },
  { id: "chaospatch", label: "ChaosPatch", primary: false },
];

export const destinationLabel = (id: Destination): string =>
  DESTINATIONS.find((d) => d.id === id)?.label ?? id;
