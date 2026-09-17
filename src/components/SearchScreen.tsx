"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeftIcon, TrashIcon } from "@/components/icons";
import { EntryCard } from "@/components/EntryCard";
import { useRunAction } from "@/components/Toast";

// Mirrors lc_search's `status` parameter, including its optionality — "All"
// is the tool omitting the argument.
const FILTERS = [
  { value: undefined, label: "All" },
  { value: "untriaged", label: "Untriaged" },
  { value: "kept", label: "Kept" },
  { value: "promoted", label: "Sent on" },
  { value: "discarded", label: "Discarded" },
] as const;

type StatusFilter = (typeof FILTERS)[number]["value"];

export function SearchScreen() {
  const { isAuthenticated } = useConvexAuth();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>(undefined);

  const results = useQuery(
    api.entries.searchEntries,
    isAuthenticated && submittedQuery ? { query: submittedQuery, status } : "skip",
  );
  const undoDiscard = useMutation(api.entries.undoDiscard);
  const discardEntry = useMutation(api.entries.discardEntry);
  const keepEntry = useMutation(api.entries.keepEntry);
  const runAction = useRunAction();

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
        className="mb-3"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your archive…"
          className="w-full rounded-lg border border-olive bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-beaver focus:border-gold"
        />
      </form>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            aria-pressed={filter.value === status}
            onClick={() => setStatus(filter.value)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter.value === status ? "bg-gold font-medium text-jungle" : "text-beaver hover:text-gold"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

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
              // Every action lc_keep / lc_discard / lc_undo_discard can take on
              // an entry of this status, so search isn't a read-only dead end
              // for anything the MCP client could act on.
              <div className="flex shrink-0 items-center gap-1">
                {entry.status === "discarded" ? (
                  <button
                    onClick={() => void runAction("Couldn't restore that — try again.", () => undoDiscard({ entryId: entry._id }))}
                    className="text-xs font-medium text-gold underline"
                  >
                    Restore
                  </button>
                ) : (
                  <>
                    {entry.status !== "kept" && (
                      <button
                        onClick={() => void runAction("Couldn't keep that — try again.", () => keepEntry({ entryId: entry._id }))}
                        className="text-xs font-medium text-gold underline"
                      >
                        Keep
                      </button>
                    )}
                    <button
                      onClick={() => void runAction("Couldn't discard that — try again.", () => discardEntry({ entryId: entry._id }))}
                      aria-label="Discard"
                      className="rounded-full p-2 text-beaver hover:text-engineering"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </>
                )}
              </div>
            }
          />
        ))}
      </div>
    </main>
  );
}
