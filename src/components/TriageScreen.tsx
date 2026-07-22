"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeftIcon, MicIcon, KeyboardIcon, ChatBubbleIcon } from "@/components/icons";

export function TriageScreen() {
  const { isAuthenticated } = useConvexAuth();
  const { results, status, loadMore } = usePaginatedQuery(
    api.entries.listInbox,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 1 },
  );
  const entry = results[0];

  // A page can reactively shrink to zero items (e.g. the entry we just kept/
  // discarded no longer matches) while more untriaged entries still exist
  // further down the index — Convex signals this as canLoadMore with an
  // empty page rather than auto-advancing. Keep pulling until we land on a
  // real entry or genuinely exhaust the query.
  useEffect(() => {
    if (status === "CanLoadMore" && results.length === 0) {
      loadMore(1);
    }
  }, [status, results.length, loadMore]);

  const loading =
    status === "LoadingFirstPage" || status === "LoadingMore" || (status === "CanLoadMore" && results.length === 0);

  const keepEntry = useMutation(api.entries.keepEntry);
  const discardEntry = useMutation(api.entries.discardEntry);
  const undoDiscard = useMutation(api.entries.undoDiscard);
  const markPromoted = useMutation(api.entries.markPromoted);

  const [undoTarget, setUndoTarget] = useState<{ entryId: Id<"entries"> } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flashToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleKeep() {
    if (!entry) return;
    await keepEntry({ entryId: entry._id });
  }

  async function handleDiscard() {
    if (!entry) return;
    const entryId = entry._id;
    await discardEntry({ entryId });
    setUndoTarget({ entryId });
    setTimeout(() => setUndoTarget((current) => (current?.entryId === entryId ? null : current)), 6000);
  }

  async function handleUndo() {
    if (!undoTarget) return;
    await undoDiscard({ entryId: undoTarget.entryId });
    setUndoTarget(null);
  }

  async function handleSendTo(destination: "kindling" | "controlledchaos") {
    if (!entry?.transcript) return;
    await navigator.clipboard.writeText(entry.transcript);
    await markPromoted({ entryId: entry._id, destination });
    flashToast(`Copied — paste into ${destination === "kindling" ? "Kindling" : "ControlledChaos"}`);
  }

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/inbox" aria-label="Back to inbox" className="rounded-full p-2 text-beaver hover:text-gold">
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-heading text-2xl">Triage</h1>
        <span className="w-5" />
      </header>

      <div className="flex flex-1 items-center justify-center">
        {loading ? (
          <p className="text-sm text-beaver">Loading…</p>
        ) : !entry ? (
          <p className="text-sm text-beaver">Nothing left to triage.</p>
        ) : (
          <div className="w-full max-w-md rounded-lg border border-olive p-6">
            <div className="mb-3 flex items-center gap-2 text-beaver">
              {entry.captureMode === "voice" ? (
                <MicIcon size={16} />
              ) : entry.captureMode === "text" ? (
                <KeyboardIcon size={16} />
              ) : (
                <ChatBubbleIcon size={16} />
              )}
              <span className="text-xs">{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap text-base">
              {entry.transcript ??
                (entry.transcriptionStatus === "failed"
                  ? "(couldn't transcribe — audio available)"
                  : "Transcribing…")}
            </p>
            {entry.captureMode === "voice" && entry.audioUrl && (
              <audio controls src={entry.audioUrl} className="mt-3 w-full" />
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={handleKeep}
          disabled={!entry}
          className="rounded-lg bg-gold py-3 text-sm font-medium text-jungle disabled:opacity-30"
        >
          Keep
        </button>
        <button
          onClick={handleDiscard}
          disabled={!entry}
          className="rounded-lg bg-engineering py-3 text-sm text-white disabled:opacity-30"
        >
          Discard
        </button>
        <button
          onClick={() => handleSendTo("kindling")}
          disabled={!entry?.transcript}
          className="rounded-lg bg-olive py-3 text-sm text-white disabled:opacity-30"
        >
          Kindling
        </button>
        <button
          onClick={() => handleSendTo("controlledchaos")}
          disabled={!entry?.transcript}
          className="rounded-lg bg-olive py-3 text-sm text-white disabled:opacity-30"
        >
          → CC
        </button>
      </div>

      {undoTarget && (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto flex w-fit items-center gap-3 rounded-full bg-olive px-4 py-2 text-sm text-white">
          <span>Discarded</span>
          <button onClick={handleUndo} className="font-medium text-gold underline">
            Undo
          </button>
        </div>
      )}
      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-full bg-olive px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </main>
  );
}
