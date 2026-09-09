"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeftIcon, SearchIcon, LayersIcon, ArchiveIcon, SettingsIcon } from "@/components/icons";
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
      <header className="mb-4 flex items-center justify-between">
        <Link href="/" aria-label="Back to record" className="rounded-full p-2 text-beaver hover:text-gold">
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-heading text-3xl">Inbox</h1>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-sm text-beaver">
            {untriagedCount === undefined ? "" : formatCount(untriagedCount)}
          </span>
          <Link href="/search" aria-label="Search" className="rounded-full p-2 text-beaver hover:text-gold">
            <SearchIcon size={18} />
          </Link>
          <Link href="/triage" aria-label="Triage" className="rounded-full p-2 text-beaver hover:text-gold">
            <LayersIcon size={18} />
          </Link>
          <Link href="/kept" aria-label="Archive" className="rounded-full p-2 text-beaver hover:text-gold">
            <ArchiveIcon size={18} />
          </Link>
          <Link href="/settings" aria-label="Settings" className="rounded-full p-2 text-beaver hover:text-gold">
            <SettingsIcon size={18} />
          </Link>
        </div>
      </header>

      <div className="flex-1 space-y-2">
        {result === undefined && <p className="text-sm text-beaver">Loading…</p>}
        {result?.page.length === 0 && <p className="text-sm text-beaver">Nothing to triage.</p>}
        {result?.page.map((entry) => <EntryCard key={entry._id} entry={entry} />)}
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
