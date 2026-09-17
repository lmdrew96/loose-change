"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeftIcon, TrashIcon } from "@/components/icons";
import { EntryCard } from "@/components/EntryCard";
import { useRunAction, useToast } from "@/components/Toast";
import { STATUS_LABELS } from "@/lib/labels";

const PAGE_SIZE = 20;

// Promoted and discarded entries used to have no browse surface at all — you
// could only reach them by guessing a search term. Kept stays the default
// since it's the archive you actually revisit.
const TABS = [
  { status: "kept", label: STATUS_LABELS.kept, empty: "Nothing kept yet." },
  { status: "promoted", label: STATUS_LABELS.promoted, empty: "Nothing sent to another app yet." },
  { status: "discarded", label: STATUS_LABELS.discarded, empty: "Nothing discarded." },
] as const;

type Status = (typeof TABS)[number]["status"];

export function KeptScreen() {
  const { isAuthenticated } = useConvexAuth();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("kept");

  // The weekly reminder deep-links to one specific entry. It may sit well past
  // the first page of the archive, so it's fetched directly and pinned above
  // the list rather than hunted for in it.
  const highlightedId = searchParams.get("entry") as Id<"entries"> | null;
  const highlighted = useQuery(
    api.entries.getEntry,
    isAuthenticated && highlightedId ? { entryId: highlightedId } : "skip",
  );
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];

  const result = useQuery(
    api.entries.listByStatus,
    isAuthenticated ? { status, paginationOpts: { numItems: PAGE_SIZE, cursor } } : "skip",
  );

  const discardEntry = useMutation(api.entries.discardEntry);
  const undoDiscard = useMutation(api.entries.undoDiscard);
  const showToast = useToast();
  const runAction = useRunAction();

  function selectStatus(next: Status) {
    setStatus(next);
    setCursorStack([null]);
  }

  // The same 30-day discard Triage and Search offer. It used to be called
  // "Delete" here, which also wrongly implied it was permanent.
  async function handleDiscard(entryId: Id<"entries">) {
    const result = await runAction("Couldn't discard that — try again.", () => discardEntry({ entryId }));
    if (!result.ok) return;
    showToast({
      message: "Discarded",
      durationMs: 6000,
      action: { label: "Undo", onClick: () => void handleRestore(entryId) },
    });
  }

  async function handleRestore(entryId: Id<"entries">) {
    await runAction("Couldn't restore that — try again.", () => undoDiscard({ entryId }));
  }

  function goNext() {
    if (!result || result.isDone) return;
    setCursorStack((stack) => [...stack, result.continueCursor]);
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }

  const activeTab = TABS.find((t) => t.status === status)!;

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/inbox" aria-label="Back to inbox" className="rounded-full p-2 text-beaver hover:text-gold">
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-heading text-2xl">Archive</h1>
        <span className="w-5" />
      </header>

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Filter by status">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            role="tab"
            aria-selected={tab.status === status}
            onClick={() => selectStatus(tab.status)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab.status === status ? "bg-gold font-medium text-jungle" : "text-beaver hover:text-gold"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {highlighted && (
        <div className="mb-4">
          <p className="mb-2 text-xs text-beaver">From your reminder</p>
          <EntryCard entry={highlighted} initiallyExpanded showStatus />
        </div>
      )}

      <div className="flex-1 space-y-2">
        {result === undefined && <p className="text-sm text-beaver">Loading…</p>}
        {result?.page.length === 0 && <p className="text-sm text-beaver">{activeTab.empty}</p>}
        {result?.page
          .filter((entry) => entry._id !== highlightedId)
          .map((entry) => (
          <EntryCard
            key={entry._id}
            entry={entry}
            actions={
              status === "discarded" ? (
                <button
                  onClick={() => void handleRestore(entry._id)}
                  className="shrink-0 text-xs font-medium text-gold underline"
                >
                  Restore
                </button>
              ) : (
                <button
                  onClick={() => void handleDiscard(entry._id)}
                  aria-label="Discard"
                  className="shrink-0 rounded-full p-2 text-beaver hover:text-engineering"
                >
                  <TrashIcon size={16} />
                </button>
              )
            }
          />
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
    </main>
  );
}
