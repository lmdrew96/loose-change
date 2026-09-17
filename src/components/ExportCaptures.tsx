"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { buildExportMarkdown, exportFilename, type ExportEntry } from "@/lib/exportMarkdown";

const PAGE_SIZE = 200;

type ExportState =
  | { kind: "idle" }
  | { kind: "working"; collected: number }
  | { kind: "done"; file: File; count: number }
  | { kind: "error" };

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later rather than now: some browsers read the URL after click()
  // returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Everything captured, as one Markdown file. These are personal thoughts
 * that pile up over years, so a way to take them with you is part of trusting
 * the app with them.
 */
export function ExportCaptures() {
  const convex = useConvex();
  const [state, setState] = useState<ExportState>({ kind: "idle" });

  async function handleExport() {
    setState({ kind: "working", collected: 0 });
    try {
      const entries: ExportEntry[] = [];
      let cursor: string | null = null;
      // One page per call, so a long history never runs into Convex's
      // per-function read limit.
      for (;;) {
        const result: { page: ExportEntry[]; isDone: boolean; continueCursor: string } = await convex.query(
          api.entries.exportEntriesPage,
          { paginationOpts: { numItems: PAGE_SIZE, cursor } },
        );
        entries.push(...result.page);
        setState({ kind: "working", collected: entries.length });
        if (result.isDone) break;
        cursor = result.continueCursor;
      }

      const now = new Date();
      const file = new File([buildExportMarkdown(entries, now)], exportFilename(now), {
        type: "text/markdown",
      });
      download(file);
      setState({ kind: "done", file, count: entries.length });
    } catch (err) {
      console.error("Export failed:", err);
      setState({ kind: "error" });
    }
  }

  async function handleShare(file: File) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (err) {
      // Closing the share sheet rejects with AbortError; that's not a failure.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Share failed:", err);
        setState({ kind: "error" });
      }
    }
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-medium text-beaver">Your data</h2>
      <p className="mb-3 text-sm text-beaver">
        Download every capture as a Markdown file — date, how it was captured, where it ended up, and the
        transcript. Audio isn&rsquo;t included; its links expire, so they wouldn&rsquo;t work in a backup.
      </p>
      <button
        onClick={() => void handleExport()}
        disabled={state.kind === "working"}
        className="min-h-11 rounded-lg bg-olive px-4 text-sm text-white disabled:opacity-30"
      >
        {state.kind === "working" ? "Preparing…" : "Download all captures"}
      </button>
      <div role="status" aria-live="polite" className="mt-2 text-sm text-beaver">
        {state.kind === "working" && `Collected ${state.collected} so far…`}
        {state.kind === "done" && (
          <>
            <p>
              Saved {state.count === 1 ? "1 capture" : `${state.count} captures`} to {state.file.name}.
            </p>
            {/* Some mobile browsers, installed iOS apps especially, don't
                save downloads anywhere obvious. The share sheet can. */}
            {canShareFile(state.file) && (
              <p className="mt-1">
                Don&rsquo;t see it?{" "}
                <button
                  onClick={() => void handleShare(state.file)}
                  className="min-h-11 font-medium text-gold underline"
                >
                  Share the file instead
                </button>
              </p>
            )}
          </>
        )}
        {state.kind === "error" && (
          <p className="text-engineering">
            Couldn&rsquo;t finish the download — check your connection and try again. Nothing was changed.
          </p>
        )}
      </div>
    </section>
  );
}
