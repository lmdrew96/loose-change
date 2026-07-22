"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeftIcon, MicIcon, KeyboardIcon, ChatBubbleIcon } from "@/components/icons";

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function SearchScreen() {
  const { isAuthenticated } = useConvexAuth();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const results = useQuery(
    api.entries.searchEntries,
    isAuthenticated && submittedQuery ? { query: submittedQuery } : "skip",
  );

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
          className="w-full rounded-lg border border-olive bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-beaver/60 focus:border-gold"
        />
      </form>

      <div className="flex-1 space-y-2">
        {submittedQuery === "" && (
          <p className="text-sm text-beaver">Search transcripts across everything you&rsquo;ve captured.</p>
        )}
        {submittedQuery !== "" && results === undefined && <p className="text-sm text-beaver">Searching…</p>}
        {submittedQuery !== "" && results?.length === 0 && <p className="text-sm text-beaver">No matches.</p>}
        {results?.map((entry) => (
          <div key={entry._id} className="flex items-start gap-3 rounded-lg border border-olive p-3">
            <div className="mt-0.5 shrink-0 text-beaver">
              {entry.captureMode === "voice" ? (
                <MicIcon size={16} />
              ) : entry.captureMode === "text" ? (
                <KeyboardIcon size={16} />
              ) : (
                <ChatBubbleIcon size={16} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm">{entry.transcript}</p>
              <p className="mt-1 text-xs text-beaver">
                {timestampFormatter.format(entry.createdAt)} · {entry.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
