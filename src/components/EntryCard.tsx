"use client";

import { useState, type ReactNode } from "react";
import type { Doc } from "../../convex/_generated/dataModel";
import { MicIcon, KeyboardIcon, ChatBubbleIcon } from "@/components/icons";
import { AudioPlayer } from "@/components/AudioPlayer";
import { formatTimestamp } from "@/lib/format";

export type EntryWithAudio = Doc<"entries"> & { audioUrl: string | null };

function CaptureModeIcon({ mode }: { mode: Doc<"entries">["captureMode"] }) {
  if (mode === "voice") return <MicIcon size={16} />;
  if (mode === "text") return <KeyboardIcon size={16} />;
  return <ChatBubbleIcon size={16} />;
}

function transcriptText(entry: EntryWithAudio): string {
  if (entry.transcript !== null) return entry.transcript;
  return entry.transcriptionStatus === "failed"
    ? "(couldn't transcribe — audio available)"
    : "Transcribing…";
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
            {showStatus && ` · ${entry.status}`}
            {!expanded && " · tap to expand"}
          </p>
        </button>
        {actions}
      </div>

      {expanded && isVoice && entry.audioUrl && <AudioPlayer src={entry.audioUrl} />}
      {expanded && audioExpired && (
        <p className="mt-3 text-xs text-beaver">Audio was cleared 30 days after triage.</p>
      )}
    </div>
  );
}
