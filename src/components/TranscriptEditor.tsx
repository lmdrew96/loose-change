"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useRunAction, useToast } from "@/components/Toast";

type EditableEntry = Pick<Doc<"entries">, "_id" | "transcript" | "transcriptionStatus" | "originalTranscript">;

// Matches the server's rule: there's nothing to correct until text exists.
export const canEditTranscript = (entry: EditableEntry): boolean =>
  entry.transcript !== null && entry.transcriptionStatus !== "pending";

export const isEdited = (entry: EditableEntry): boolean => entry.originalTranscript !== undefined;

/**
 * Inline correction for a misheard word or a typo. Search, the reminder and
 * Send all use this text, so a mistake used to be permanent everywhere.
 */
export function TranscriptEditor({ entry, onDone }: { entry: EditableEntry; onDone: () => void }) {
  const updateTranscript = useMutation(api.entries.updateTranscript);
  const [value, setValue] = useState(entry.transcript ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (value.trim() === "") {
      setError("A transcript can't be empty. Cancel to keep the current one.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateTranscript({ entryId: entry._id, transcript: value });
      onDone();
    } catch (err) {
      console.error("Couldn't save transcript:", err);
      setError("Couldn't save your edit — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Stops Triage's swipe handler from capturing the pointer, which would
    // swallow taps and text selection inside the editor.
    <div className="mt-2 w-full" onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            onDone();
          }
        }}
        autoFocus
        aria-label="Edit transcript"
        rows={5}
        className="w-full resize-y rounded-lg border border-olive bg-transparent p-3 text-base text-neutral-100 outline-none focus:border-gold"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="min-h-11 rounded-lg bg-gold px-4 text-sm font-medium text-jungle disabled:opacity-30"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onDone}
          disabled={saving}
          className="min-h-11 rounded-lg px-4 text-sm text-beaver hover:text-neutral-100"
        >
          Cancel
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-1 text-sm text-engineering">
        {error}
      </p>
    </div>
  );
}

/** Edit, and Revert when there's an original to go back to. */
export function TranscriptActions({ entry, onEdit }: { entry: EditableEntry; onEdit: () => void }) {
  const revertTranscript = useMutation(api.entries.revertTranscript);
  const updateTranscript = useMutation(api.entries.updateTranscript);
  const runAction = useRunAction();
  const showToast = useToast();

  if (!canEditTranscript(entry)) return null;

  async function revert() {
    const edited = entry.transcript;
    const result = await runAction("Couldn't revert that — try again.", () =>
      revertTranscript({ entryId: entry._id }),
    );
    if (!result.ok || edited === null) return;
    // Reverting throws the edit away, so it gets an undo like everything else.
    showToast({
      message: "Back to the original transcript",
      durationMs: 6000,
      action: {
        label: "Undo",
        onClick: () =>
          void runAction("Couldn't restore your edit — try again.", () =>
            updateTranscript({ entryId: entry._id, transcript: edited }),
          ),
      },
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
      <button
        onClick={onEdit}
        className="min-h-11 rounded-lg border border-olive px-4 text-sm text-beaver hover:text-gold"
      >
        Edit transcript
      </button>
      {isEdited(entry) && (
        <button
          onClick={() => void revert()}
          className="min-h-11 rounded-lg px-4 text-sm text-beaver underline hover:text-gold"
        >
          Revert to original
        </button>
      )}
    </div>
  );
}
