"use client";

import { useEffect, useState } from "react";
import {
  deletePendingCapture,
  getPendingCaptures,
  isStuck,
  subscribePendingCaptures,
  type PendingCapture,
} from "@/lib/offlineQueue";
import { retryAllPendingCaptures } from "@/lib/syncEngine";
import { AudioPlayer } from "@/components/AudioPlayer";
import { MicIcon, KeyboardIcon } from "@/components/icons";
import { formatTimestamp } from "@/lib/format";

// A data URL rather than an object URL: an object URL needs revoking, and
// Strict Mode's mount→cleanup→remount would revoke it out from under the
// player. A data URL is just garbage-collected, and stuck captures are rare.
function VoicePreview({ blob }: { blob: Blob }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelled && typeof reader.result === "string") setSrc(reader.result);
    };
    reader.onerror = () => console.error("Couldn't read stuck capture audio:", reader.error);
    reader.readAsDataURL(blob);
    return () => {
      cancelled = true;
      reader.abort();
    };
  }, [blob]);

  return src ? <AudioPlayer src={src} /> : null;
}

function StuckCaptureRow({ capture }: { capture: PendingCapture }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDiscard() {
    setError(null);
    try {
      // Deletes this one record by localId; nothing else in the queue is touched.
      await deletePendingCapture(capture.localId);
    } catch (err) {
      console.error("Couldn't discard stuck capture:", capture.localId, err);
      setError("Couldn't discard it — try again.");
    }
  }

  return (
    <li className="rounded-lg border border-olive p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-beaver">
          {capture.captureMode === "voice" ? <MicIcon size={16} /> : <KeyboardIcon size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          {capture.captureMode === "text" && (
            <p className="whitespace-pre-wrap text-base">{capture.transcript}</p>
          )}
          <p className="mt-1 text-xs text-beaver">
            {formatTimestamp(capture.capturedAt)} · tried {capture.attempts ?? 0} times
          </p>
          {capture.lastError && (
            <p className="mt-1 break-words text-xs text-beaver">Last error: {capture.lastError}</p>
          )}
        </div>
      </div>

      {capture.captureMode === "voice" && <VoicePreview blob={capture.audioBlob} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <button onClick={handleDiscard} className="min-h-11 rounded-lg bg-engineering px-4 text-sm text-white">
              Yes, discard
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="min-h-11 rounded-lg px-4 text-sm text-beaver hover:text-neutral-100"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="min-h-11 rounded-lg border border-olive px-4 text-sm text-beaver hover:text-gold"
          >
            Discard
          </button>
        )}
      </div>
      {/* Unlike discarding an entry, this has no 30-day undo: the capture never
          reached the server, so the copy on this device is the only one. */}
      {confirming && (
        <p className="mt-2 text-xs text-beaver">
          This capture only exists on this device. Discarding it deletes it for good.
        </p>
      )}
      <p role="status" aria-live="polite" className="text-xs text-engineering">
        {error}
      </p>
    </li>
  );
}

/**
 * Captures that have failed to sync STUCK_AFTER_ATTEMPTS times. They keep
 * retrying in the background; this is where you can see which one is stuck,
 * why, and choose to drop it. Renders nothing when the queue is healthy.
 */
export function StuckCaptures() {
  const [stuck, setStuck] = useState<PendingCapture[]>([]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    function refresh() {
      void getPendingCaptures().then((captures) => setStuck(captures.filter(isStuck)));
    }
    refresh();
    return subscribePendingCaptures(refresh);
  }, []);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryAllPendingCaptures();
    } finally {
      setRetrying(false);
    }
  }

  if (stuck.length === 0) return null;

  return (
    <section id="stuck-captures" className="mb-8">
      <h2 className="mb-2 text-sm font-medium text-beaver">Captures that couldn&rsquo;t sync</h2>
      <p className="mb-3 text-sm text-beaver">
        These have failed to upload several times. They&rsquo;ll keep trying on their own — discard one only if
        you&rsquo;re sure it&rsquo;s not coming through.
      </p>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="mb-3 min-h-11 rounded-lg bg-olive px-4 text-sm text-white disabled:opacity-30"
      >
        {retrying ? "Trying…" : "Try again now"}
      </button>
      <ul className="space-y-2">
        {stuck.map((capture) => (
          <StuckCaptureRow key={capture.localId} capture={capture} />
        ))}
      </ul>
    </section>
  );
}
