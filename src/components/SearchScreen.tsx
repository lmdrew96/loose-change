"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TrashIcon } from "@/components/icons";
import { EntryCard } from "@/components/EntryCard";
import { useEntryActions } from "@/components/useEntryActions";
import { STATUS_LABELS, type EntryStatus } from "@/lib/labels";
import { replaceQueryParams } from "@/lib/urlState";

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

// Asked for explicitly so the "there may be more" note can compare against it.
const SEARCH_LIMIT = 20;

const asStatusFilter = (value: string | null): StatusFilter =>
  FILTERS.find((f) => f.value !== undefined && f.value === value)?.value;

export function SearchScreen() {
  const { isAuthenticated } = useConvexAuth();
  // The submitted query and filter live in the URL (?q=, ?status=), so
  // leaving Search and coming Back lands on the same results.
  const searchParams = useSearchParams();
  const submittedQuery = searchParams.get("q") ?? "";
  const status = asStatusFilter(searchParams.get("status"));
  const [query, setQuery] = useState(submittedQuery);

  const results = useQuery(
    api.entries.searchEntries,
    isAuthenticated && submittedQuery ? { query: submittedQuery, status, limit: SEARCH_LIMIT } : "skip",
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
          replaceQueryParams({ q: query.trim() });
        }}
        role="search"
        className="mb-3 flex gap-2"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your archive…"
          aria-label="Search transcripts"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-olive bg-transparent px-3 text-base text-neutral-100 outline-none placeholder:text-beaver focus:border-gold"
        />
        <button type="submit" className="min-h-11 rounded-lg bg-gold px-4 text-sm font-medium text-jungle">
          Search
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            aria-pressed={filter.value === status}
            onClick={() => replaceQueryParams({ status: filter.value ?? null })}
            className={`min-h-11 rounded-full px-4 text-sm ${
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
        {/* Search stops at the limit, so a full page probably isn't all of it. */}
        {results?.length === SEARCH_LIMIT && (
          <p className="text-sm text-beaver">
            Showing the {SEARCH_LIMIT} most relevant — refine your search to narrow it.
          </p>
        )}
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
              <>
                {entry.status === "discarded" ? (
                  <button
                    onClick={() => void restore(entry._id)}
                    className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-gold underline"
                  >
                    Restore
                  </button>
                ) : (
                  <>
                    {entry.status !== "untriaged" && (
                      <button
                        onClick={() => void returnToInbox(entry._id)}
                        className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-gold underline"
                      >
                        Move to Inbox
                      </button>
                    )}
                    {entry.status !== "kept" && (
                      <button
                        onClick={() => void keep(entry._id)}
                        className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-gold underline"
                      >
                        Keep
                      </button>
                    )}
                    <button
                      onClick={() => void discard(entry._id)}
                      aria-label="Discard"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-beaver hover:text-engineering"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </>
                )}
              </>
            }
          />
        ))}
      </div>
    </main>
  );
}
