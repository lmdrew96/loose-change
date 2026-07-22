"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeftIcon, MicIcon, KeyboardIcon, ChatBubbleIcon } from "@/components/icons";

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const results = useQuery(api.entries.searchEntries, submittedQuery ? { query: submittedQuery } : "skip");

  return (
    <main className="flex flex-1 flex-col p-6">
      <header className="mb-4 flex items-center gap-3">
        <Link
          href="/inbox"
          aria-label="Back to inbox"
          className="rounded-full p-2 text-neutral-400 hover:text-neutral-600"
        >
          <ArrowLeftIcon />
        </Link>
        <h1 className="text-lg font-semibold">Search</h1>
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
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-900"
        />
      </form>

      <div className="flex-1 space-y-2">
        {submittedQuery === "" && (
          <p className="text-sm text-neutral-500">Search transcripts across everything you&rsquo;ve captured.</p>
        )}
        {submittedQuery !== "" && results === undefined && <p className="text-sm text-neutral-500">Searching…</p>}
        {submittedQuery !== "" && results?.length === 0 && <p className="text-sm text-neutral-500">No matches.</p>}
        {results?.map((entry) => (
          <div
            key={entry._id}
            className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
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
              <p className="line-clamp-2 text-sm">{entry.transcript}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {timestampFormatter.format(entry.createdAt)} · {entry.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
