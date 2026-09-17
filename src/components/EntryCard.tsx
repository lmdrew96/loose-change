"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { MicIcon, KeyboardIcon, ChatBubbleIcon } from "@/components/icons";
import { AudioPlayer } from "@/components/AudioPlayer";
import { discardCountdown, formatTimestamp } from "@/lib/format";
import { STATUS_LABELS, destinationLabel } from "@/lib/labels";

export type EntryWithAudio = Doc<"entries"> & { audioUrl: string | null };

function CaptureModeIcon({ mode }: { mode: Doc<"entries">["captureMode"] }) {
  if (mode === "voice") return <MicIcon size={16} />;
  if (mode === "text") return <KeyboardIcon size={16} />;
  return <ChatBubbleIcon size={16} />;
}

export function transcriptPlaceholder(status: Doc<"entries">["transcriptionStatus"]): string {
  if (status === "failed") return "(couldn't transcribe — audio available)";
  // Not the same as failed: nothing is wrong with the audio, AssemblyAI just
  // hadn't finished (or its result couldn't be read) when we last checked.
  // Worded so it doesn't read as broken, and paired with a retry once the
  // card is expanded.
  if (status === "timed_out") return "(transcription didn't finish — audio is still here)";
  return "Transcribing…";
}

function transcriptText(entry: EntryWithAudio): string {
  return entry.transcript ?? transcriptPlaceholder(entry.transcriptionStatus);
}

function RetryTranscription({ entryId }: { entryId: Doc<"entries">["_id"] }) {
  const retryTranscription = useMutation(api.entries.retryTranscription);
  const [state, setState] = useState<"idle" | "retrying" | "error">("idle");

  async function handleRetry() {
    setState("retrying");
    try {
      // On success the entry flips to "pending" reactively and this unmounts,
      // so there's no success state to show here.
      await retryTranscription({ entryId });
    } catch (err) {
      console.error("Retry transcription failed:", err);
      setState("error");
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={handleRetry}
        disabled={state === "retrying"}
        className="rounded-lg border border-olive px-3 py-1.5 text-xs text-beaver hover:text-gold disabled:opacity-30"
      >
        Try transcribing again
      </button>
      <p role="status" aria-live="polite" className="mt-1 text-xs text-beaver">
        {state === "error" && "Couldn't start the retry — try again in a moment."}
      </p>
    </div>
  );
}

/**
 * One captured thought, collapsed to two lines until tapped.
 *
 * Expanding is the only way to read a long transcript or replay a voice memo
 * once it has left Triage — before this existed, keeping a memo meant never
 * seeing past its first two lines again, which also made the README's
 * "garbled transcript? the audio is still there" fallback unreachable.
 */
export function EntryCard({
  entry,
  actions,
  showStatus = false,
  initiallyExpanded = false,
}: {
  entry: EntryWithAudio;
  actions?: ReactNode;
  showStatus?: boolean;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  // Read once per mount: a countdown in days doesn't need to tick live.
  const [now] = useState(() => Date.now());
  const text = transcriptText(entry);
  const isVoice = entry.captureMode === "voice";
  // Retention clears the blob 30 days after triage but keeps the transcript,
  // so an expanded old voice memo needs to explain the missing player rather
  // than just not having one.
  const audioExpired = isVoice && entry.audioUrl === null && entry.audioDeletedAt !== null;

  return (
    <div className="rounded-lg border border-olive p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-beaver">
          <CaptureModeIcon mode={entry.captureMode} />
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <p className={`text-sm ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{text}</p>
          <p className="mt-1 text-xs text-beaver">
            {formatTimestamp(entry.createdAt)}
            {showStatus && entry.status !== "promoted" && ` · ${STATUS_LABELS[entry.status]}`}
            {/* "Where did I send that?" is exactly the gap this app covers, so
                a sent entry always names its destination, not just in Search. */}
            {entry.status === "promoted" &&
              (entry.promotedTo ? ` · Sent to ${destinationLabel(entry.promotedTo)}` : ` · ${STATUS_LABELS.promoted}`)}
            {/* A hidden deadline made visible: how long Restore still works. */}
            {entry.status === "discarded" &&
              entry.discardedAt !== null &&
              ` · ${discardCountdown(entry.discardedAt, now)}`}
            {!expanded && " · tap to expand"}
          </p>
        </button>
        {actions}
      </div>

      {expanded && isVoice && entry.audioUrl && <AudioPlayer src={entry.audioUrl} />}
      {expanded && entry.transcriptionStatus === "timed_out" && entry.audioStorageId !== null && (
        <RetryTranscription entryId={entry._id} />
      )}
      {expanded && audioExpired && (
        <p className="mt-3 text-xs text-beaver">Audio was cleared 30 days after triage.</p>
      )}
    </div>
  );
}
