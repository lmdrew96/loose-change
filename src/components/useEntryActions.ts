"use client";

import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useRunAction, useToast } from "@/components/Toast";
import { STATUS_LABELS } from "@/lib/labels";

type EntryId = Id<"entries">;

/**
 * Entry actions with the same feedback on every screen. Discard used to have
 * an undo toast in Triage and Archive but not Search; Restore confirmed
 * nothing anywhere. Same button, same behaviour, wherever it appears.
 */
export function useEntryActions() {
  const showToast = useToast();
  const runAction = useRunAction();
  const keepEntry = useMutation(api.entries.keepEntry);
  const discardEntry = useMutation(api.entries.discardEntry);
  const undoDiscard = useMutation(api.entries.undoDiscard);
  const returnToInboxMutation = useMutation(api.entries.returnToInbox);

  async function restore(entryId: EntryId): Promise<void> {
    const result = await runAction("Couldn't restore that — try again.", () => undoDiscard({ entryId }));
    if (result.ok) showToast({ message: `Restored to ${STATUS_LABELS[result.value]}` });
  }

  async function discard(entryId: EntryId): Promise<void> {
    const result = await runAction("Couldn't discard that — try again.", () => discardEntry({ entryId }));
    if (!result.ok) return;
    showToast({
      message: "Discarded — you can also restore it from Archive for 30 days.",
      durationMs: 6000,
      action: { label: "Undo", onClick: () => void restore(entryId) },
    });
  }

  async function returnToInbox(entryId: EntryId): Promise<void> {
    const result = await runAction("Couldn't move that to your Inbox — try again.", () =>
      returnToInboxMutation({ entryId }),
    );
    if (result.ok) showToast({ message: `Moved to ${STATUS_LABELS.untriaged}` });
  }

  // Shows an Undo that puts the entry back in the Inbox. Used after decisions
  // made from the Inbox (Triage), where "undo" and "back to Inbox" are the
  // same thing.
  function offerUndoToInbox(entryId: EntryId, message: string, link?: { label: string; href: string }): void {
    showToast({
      message,
      link,
      durationMs: 6000,
      action: { label: "Undo", onClick: () => void returnToInbox(entryId) },
    });
  }

  async function keep(entryId: EntryId, { undoable = false } = {}): Promise<void> {
    const result = await runAction("Couldn't keep that — try again.", () => keepEntry({ entryId }));
    if (!result.ok) return;
    if (undoable) offerUndoToInbox(entryId, "Kept");
    else showToast({ message: "Kept" });
  }

  return { keep, discard, restore, returnToInbox, offerUndoToInbox, runAction, showToast };
}
