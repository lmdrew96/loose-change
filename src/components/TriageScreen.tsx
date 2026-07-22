"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeftIcon, MicIcon, KeyboardIcon, ChatBubbleIcon } from "@/components/icons";

export function TriageScreen() {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(
    api.entries.listInbox,
    isAuthenticated ? { paginationOpts: { numItems: 1, cursor: null } } : "skip",
  );
  const entry = result?.page[0];

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
    <main className="flex flex-1 flex-col p-6">
      <header className="mb-4 flex items-center justify-between">
        <Link
          href="/inbox"
          aria-label="Back to inbox"
          className="rounded-full p-2 text-neutral-400 hover:text-neutral-600"
        >
          <ArrowLeftIcon />
        </Link>
        <h1 className="text-lg font-semibold">Triage</h1>
        <span className="w-5" />
      </header>

      <div className="flex flex-1 items-center justify-center">
        {result === undefined ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : !entry ? (
          <p className="text-sm text-neutral-500">Nothing left to triage.</p>
        ) : (
          <div className="w-full max-w-md rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
            <div className="mb-3 flex items-center gap-2 text-neutral-400">
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
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={handleKeep}
          disabled={!entry}
          className="rounded-lg bg-neutral-800 py-3 text-sm text-white disabled:opacity-30"
        >
          Keep
        </button>
        <button
          onClick={handleDiscard}
          disabled={!entry}
          className="rounded-lg bg-neutral-800 py-3 text-sm text-white disabled:opacity-30"
        >
          Discard
        </button>
        <button
          onClick={() => handleSendTo("kindling")}
          disabled={!entry?.transcript}
          className="rounded-lg bg-neutral-800 py-3 text-sm text-white disabled:opacity-30"
        >
          Kindling
        </button>
        <button
          onClick={() => handleSendTo("controlledchaos")}
          disabled={!entry?.transcript}
          className="rounded-lg bg-neutral-800 py-3 text-sm text-white disabled:opacity-30"
        >
          → CC
        </button>
      </div>

      {undoTarget && (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto flex w-fit items-center gap-3 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white">
          <span>Discarded</span>
          <button onClick={handleUndo} className="font-medium underline">
            Undo
          </button>
        </div>
      )}
      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-full bg-neutral-900 px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </main>
  );
}
