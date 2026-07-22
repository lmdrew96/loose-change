"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { MicIcon, KeyboardIcon, ChatBubbleIcon, ArrowLeftIcon } from "@/components/icons";

const PAGE_SIZE = 20;

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function InboxScreen() {
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];

  const result = useQuery(api.entries.listInbox, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
  const untriagedCount = useQuery(api.entries.getUntriagedCount);

  function goNext() {
    if (!result || result.isDone) return;
    setCursorStack((stack) => [...stack, result.continueCursor]);
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }

  return (
    <main className="flex flex-1 flex-col p-6">
      <header className="mb-4 flex items-center justify-between">
        <Link
          href="/"
          aria-label="Back to record"
          className="rounded-full p-2 text-neutral-400 hover:text-neutral-600"
        >
          <ArrowLeftIcon />
        </Link>
        <h1 className="text-lg font-semibold">Inbox</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{untriagedCount ?? ""}</span>
          <Link href="/search" className="text-sm underline">
            Search
          </Link>
          <Link href="/triage" className="text-sm underline">
            Triage
          </Link>
        </div>
      </header>

      <div className="flex-1 space-y-2">
        {result === undefined && <p className="text-sm text-neutral-500">Loading…</p>}
        {result?.page.length === 0 && <p className="text-sm text-neutral-500">Nothing to triage.</p>}
        {result?.page.map((entry) => <EntryCard key={entry._id} entry={entry} />)}
      </div>

      <div className="mt-4 flex justify-between">
        <button onClick={goPrev} disabled={cursorStack.length <= 1} className="text-sm disabled:opacity-30">
          ← Previous
        </button>
        <button onClick={goNext} disabled={!result || result.isDone} className="text-sm disabled:opacity-30">
          Next →
        </button>
      </div>
    </main>
  );
}

function EntryCard({ entry }: { entry: Doc<"entries"> }) {
  const preview =
    entry.transcript ??
    (entry.transcriptionStatus === "failed" ? "(couldn't transcribe — audio available)" : "Transcribing…");

  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mt-0.5 shrink-0 text-neutral-400">
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
        <p className="mt-1 text-xs text-neutral-500">{timestampFormatter.format(entry.createdAt)}</p>
      </div>
    </div>
  );
}
