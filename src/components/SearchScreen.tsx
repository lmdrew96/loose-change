"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeftIcon, TrashIcon } from "@/components/icons";
import { EntryCard } from "@/components/EntryCard";

export function SearchScreen() {
  const { isAuthenticated } = useConvexAuth();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const results = useQuery(
    api.entries.searchEntries,
    isAuthenticated && submittedQuery ? { query: submittedQuery } : "skip",
  );
  const undoDiscard = useMutation(api.entries.undoDiscard);
  const discardEntry = useMutation(api.entries.discardEntry);

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/inbox" aria-label="Back to inbox" className="rounded-full p-2 text-beaver hover:text-gold">
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-heading text-2xl">Search</h1>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQuery(query.trim());
        }}
        className="mb-4"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your archive…"
          className="w-full rounded-lg border border-olive bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-beaver focus:border-gold"
        />
      </form>

      <div className="flex-1 space-y-2">
        {submittedQuery === "" && (
          <p className="text-sm text-beaver">Search transcripts across everything you&rsquo;ve captured.</p>
        )}
        {submittedQuery !== "" && results === undefined && <p className="text-sm text-beaver">Searching…</p>}
        {submittedQuery !== "" && results?.length === 0 && <p className="text-sm text-beaver">No matches.</p>}
        {results?.map((entry) => (
          <EntryCard
            key={entry._id}
            entry={entry}
            showStatus
            actions={
              entry.status === "discarded" ? (
                <button
                  onClick={() => void undoDiscard({ entryId: entry._id })}
                  className="shrink-0 text-xs font-medium text-gold underline"
                >
                  Undo
                </button>
              ) : entry.status === "kept" ? (
                <button
                  onClick={() => void discardEntry({ entryId: entry._id })}
                  aria-label="Delete"
                  className="shrink-0 rounded-full p-2 text-beaver hover:text-engineering"
                >
                  <TrashIcon size={16} />
                </button>
              ) : null
            }
          />
        ))}
      </div>
    </main>
  );
}
