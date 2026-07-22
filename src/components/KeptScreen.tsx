"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { MicIcon, KeyboardIcon, ChatBubbleIcon, ArrowLeftIcon, TrashIcon } from "@/components/icons";

const PAGE_SIZE = 20;

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function KeptScreen() {
  const { isAuthenticated } = useConvexAuth();
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];

  const result = useQuery(
    api.entries.listKept,
    isAuthenticated ? { paginationOpts: { numItems: PAGE_SIZE, cursor } } : "skip",
  );

  const discardEntry = useMutation(api.entries.discardEntry);
  const undoDiscard = useMutation(api.entries.undoDiscard);
  const [undoTarget, setUndoTarget] = useState<{ entryId: Id<"entries"> } | null>(null);

  async function handleDelete(entryId: Id<"entries">) {
    await discardEntry({ entryId });
    setUndoTarget({ entryId });
    setTimeout(() => setUndoTarget((current) => (current?.entryId === entryId ? null : current)), 6000);
  }

  async function handleUndo() {
    if (!undoTarget) return;
    await undoDiscard({ entryId: undoTarget.entryId });
    setUndoTarget(null);
  }

  function goNext() {
    if (!result || result.isDone) return;
    setCursorStack((stack) => [...stack, result.continueCursor]);
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/inbox" aria-label="Back to inbox" className="rounded-full p-2 text-beaver hover:text-gold">
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-heading text-2xl">Kept</h1>
        <span className="w-5" />
      </header>

      <div className="flex-1 space-y-2">
        {result === undefined && <p className="text-sm text-beaver">Loading…</p>}
        {result?.page.length === 0 && <p className="text-sm text-beaver">Nothing kept yet.</p>}
        {result?.page.map((entry) => (
          <EntryCard key={entry._id} entry={entry} onDelete={() => void handleDelete(entry._id)} />
        ))}
      </div>

      <div className="mt-4 flex justify-between">
        <button onClick={goPrev} disabled={cursorStack.length <= 1} className="text-sm text-gold disabled:opacity-30">
          ← Previous
        </button>
        <button onClick={goNext} disabled={!result || result.isDone} className="text-sm text-gold disabled:opacity-30">
          Next →
        </button>
      </div>

      {undoTarget && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-3 rounded-full bg-olive px-4 py-2 text-sm text-white"
        >
          <span>Deleted</span>
          <button onClick={handleUndo} className="font-medium text-gold underline">
            Undo
          </button>
        </div>
      )}
    </main>
  );
}

function EntryCard({
  entry,
  onDelete,
}: {
  entry: Doc<"entries"> & { audioUrl: string | null };
  onDelete: () => void;
}) {
  const preview =
    entry.transcript ??
    (entry.transcriptionStatus === "failed" ? "(couldn't transcribe — audio available)" : "Transcribing…");

  return (
    <div className="flex items-start gap-3 rounded-lg border border-olive p-3">
      <div className="mt-0.5 shrink-0 text-beaver">
        {entry.captureMode === "voice" ? (
          <MicIcon size={16} />
        ) : entry.captureMode === "text" ? (
          <KeyboardIcon size={16} />
        ) : (
          <ChatBubbleIcon size={16} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm">{preview}</p>
        <p className="mt-1 text-xs text-beaver">{timestampFormatter.format(entry.createdAt)}</p>
      </div>
      <button
        onClick={onDelete}
        aria-label="Delete"
        className="shrink-0 rounded-full p-2 text-beaver hover:text-engineering"
      >
        <TrashIcon size={16} />
      </button>
    </div>
  );
}
