"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TrashIcon } from "@/components/icons";
import { EntryCard } from "@/components/EntryCard";
import { useEntryActions } from "@/components/useEntryActions";
import { STATUS_LABELS, type EntryStatus } from "@/lib/labels";

// Mirrors lc_search's `status` parameter, including its optionality — "All"
// is the tool omitting the argument.
const FILTERS: readonly { value: EntryStatus | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  ...(["untriaged", "kept", "promoted", "discarded"] as const).map((value) => ({
    value,
    label: STATUS_LABELS[value],
  })),
];

type StatusFilter = EntryStatus | undefined;

export function SearchScreen() {
  const { isAuthenticated } = useConvexAuth();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>(undefined);

  const results = useQuery(
    api.entries.searchEntries,
    isAuthenticated && submittedQuery ? { query: submittedQuery, status } : "skip",
  );
  const { keep, discard, restore, returnToInbox } = useEntryActions();

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4">
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
              // Every action lc_keep / lc_discard / lc_undo_discard /
              // lc_return_to_inbox can take on an entry of this status, so
              // search isn't a read-only dead end for anything the MCP client
              // could act on.
              <div className="flex shrink-0 items-center gap-1">
                {entry.status === "discarded" ? (
                  <button
                    onClick={() => void restore(entry._id)}
                    className="text-xs font-medium text-gold underline"
                  >
                    Restore
                  </button>
                ) : (
                  <>
                    {entry.status !== "untriaged" && (
                      <button
                        onClick={() => void returnToInbox(entry._id)}
                        className="text-xs font-medium text-gold underline"
                      >
                        Move to Inbox
                      </button>
                    )}
                    {entry.status !== "kept" && (
                      <button
                        onClick={() => void keep(entry._id)}
                        className="text-xs font-medium text-gold underline"
                      >
                        Keep
                      </button>
                    )}
                    <button
                      onClick={() => void discard(entry._id)}
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
