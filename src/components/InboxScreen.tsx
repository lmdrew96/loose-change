"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { EntryCard } from "@/components/EntryCard";
import { formatCount } from "@/lib/format";

const PAGE_SIZE = 20;

export function InboxScreen() {
  const { isAuthenticated } = useConvexAuth();
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];

  const result = useQuery(
    api.entries.listInbox,
    isAuthenticated ? { paginationOpts: { numItems: PAGE_SIZE, cursor } } : "skip",
  );
  const untriagedCount = useQuery(api.entries.getUntriagedCount, isAuthenticated ? {} : "skip");

  function goNext() {
    if (!result || result.isDone) return;
    setCursorStack((stack) => [...stack, result.continueCursor]);
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4">
        <h1 className="font-heading text-2xl">Inbox</h1>
      </header>

      {/* Triage is the obvious next thing to do with a non-empty inbox, so it's
          the primary action here rather than one of several equal icons. It
          also carries the untriaged count — still a plain number, no badge. */}
      {untriagedCount !== undefined && untriagedCount.count > 0 && (
        <Link
          href="/triage"
          className="mb-4 flex min-h-12 items-center justify-center rounded-lg bg-gold font-medium text-jungle"
        >
          Triage {formatCount(untriagedCount)}
        </Link>
      )}

      <div className="flex-1 space-y-2">
        {result === undefined && <p className="text-sm text-beaver">Loading…</p>}
        {result?.page.length === 0 && <p className="text-sm text-beaver">Nothing to triage.</p>}
        {result?.page.map((entry) => <EntryCard key={entry._id} entry={entry} />)}
      </div>

      <div className="mt-4 flex justify-between">
        <button onClick={goPrev} disabled={cursorStack.length <= 1} className="min-h-11 px-2 text-sm text-gold disabled:opacity-30">
          ← Previous
        </button>
        <button onClick={goNext} disabled={!result || result.isDone} className="min-h-11 px-2 text-sm text-gold disabled:opacity-30">
          Next →
        </button>
      </div>
    </main>
  );
}
