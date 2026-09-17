"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  addPendingCapture,
  appendRecordingChunk,
  cancelInProgressRecording,
  clearDraftText,
  finalizeInProgressRecording,
  getDraftText,
  getPendingCaptures,
  isStuck,
  saveDraftText,
  startInProgressRecording,
  subscribePendingCaptures,
} from "@/lib/offlineQueue";
import { syncPendingCaptures } from "@/lib/syncEngine";
import { formatCount } from "@/lib/format";
import {
  START_VIBRATION,
  STOP_VIBRATION,
  playTone,
  primeTones,
  useWakeLock,
  vibrate,
} from "@/lib/recordingFeedback";
import { MicIcon, StopIcon, CheckIcon, KeyboardIcon, InboxIcon, XIcon } from "@/components/icons";

type View = "voice-idle" | "voice-recording" | "saved" | "text";

// How often MediaRecorder flushes a chunk during recording. Chunks are
// persisted to IndexedDB as they arrive, so at most this much trailing audio
// is at risk if the app is killed mid-recording.
const RECORDING_TIMESLICE_MS = 5000;

// How long to wait after the last keystroke before persisting the text
// draft — frequent enough that little typing is at risk, infrequent enough
// to not hammer IndexedDB on every keystroke.
const DRAFT_SAVE_DEBOUNCE_MS = 800;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// How long you've been recording. Without it there's no sense of scale at all
// — you tap stop having no idea whether that was 20 seconds or four minutes,
// which is exactly the thing an ADHD brain doesn't supply on its own.
//
// Its own component so it's mounted only while recording: state starts at zero
// by construction instead of an effect reaching in to reset it. Ticks off a
// start timestamp rather than accumulating, so a throttled background tab
// doesn't drift.
function RecordingTimer() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, []);

  return (
    <p aria-hidden className="font-mono text-sm text-beaver">
      {formatElapsed(elapsedMs)}
    </p>
  );
}

export function RecordScreen() {
  const { isAuthenticated } = useConvexAuth();
  const untriagedCount = useQuery(api.entries.getUntriagedCount, isAuthenticated ? {} : "skip");
  const [view, setView] = useState<View>("voice-idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [textValue, setTextValue] = useState("");
  const [textSaved, setTextSaved] = useState(false);
  const [syncCounts, setSyncCounts] = useState({ waiting: 0, stuck: 0 });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pendingAppendsRef = useRef<Promise<void>[]>([]);
  const recordingLocalIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Released on stop, cancel and unmount by the hook itself.
  useWakeLock(view === "voice-recording");

  useEffect(() => {
    if (view === "text") textareaRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (view !== "saved") return;
    const timer = setTimeout(() => setView("voice-idle"), 1200);
    return () => clearTimeout(timer);
  }, [view]);

  // Restore an unsaved draft left behind by a previous session (e.g. the
  // user navigated away or the app closed before tapping Save).
  useEffect(() => {
    getDraftText().then((draft) => {
      if (draft) setTextValue(draft);
    });
  }, []);

  // Reflects captures still sitting in IndexedDB, split so a capture that keeps
  // failing doesn't masquerade as one merely waiting for signal — a "pending"
  // count that never goes down teaches you to ignore it.
  useEffect(() => {
    function refresh() {
      void getPendingCaptures().then((captures) => {
        const stuck = captures.filter(isStuck).length;
        setSyncCounts({ waiting: captures.length - stuck, stuck });
      });
    }
    refresh();
    return subscribePendingCaptures(refresh);
  }, []);

  // Debounce-persist the draft as the user types, so it survives navigating
  // away or the app closing before Save is tapped.
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      if (textValue.trim()) void saveDraftText(textValue);
      else void clearDraftText();
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [textValue]);

  async function startRecording() {
    setMicError(null);
    primeTones();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const localId = crypto.randomUUID();
      const startedAt = Date.now();
      pendingAppendsRef.current = [];
      recordingLocalIdRef.current = localId;
      cancelledRef.current = false;

      // mimeType isn't reliably populated until the recorder actually starts,
      // so the in-progress record is created from onstart rather than before
      // recorder.start() — offlineQueue serializes this against chunk
      // appends, so no chunk can arrive before the record exists.
      recorder.onstart = () => {
        // Confirmation that it's actually listening, for when the screen
        // can't be looked at. Fired here rather than on tap so a mic failure
        // never buzzes as if it had started.
        vibrate(START_VIBRATION);
        playTone("start");
        pendingAppendsRef.current.push(
          startInProgressRecording(localId, recorder.mimeType || "audio/webm", startedAt),
        );
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          pendingAppendsRef.current.push(appendRecordingChunk(localId, e.data));
        }
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        await Promise.all(pendingAppendsRef.current);
        if (cancelledRef.current) {
          await cancelInProgressRecording(localId);
          setView("voice-idle");
          return;
        }
        const saved = await finalizeInProgressRecording(localId);
        if (saved) {
          // Nothing on cancel — only a saved memo gets the "done" pattern.
          vibrate(STOP_VIBRATION);
          playTone("stop");
          void syncPendingCaptures();
          setView("saved");
        } else {
          setView("voice-idle");
        }
      };
      recorder.start(RECORDING_TIMESLICE_MS);
      mediaRecorderRef.current = recorder;
      setView("voice-recording");
    } catch (err) {
      // Says what to do next, not just that it failed. NotFoundError means
      // there's no microphone at all, which no permission change will fix.
      const name = err instanceof DOMException ? err.name : "";
      setMicError(
        name === "NotFoundError"
          ? "No microphone found. Connect one, or use text mode (keyboard icon, top right)."
          : "Loose Change needs your microphone. Allow it in your browser's site settings (the icon beside the address bar, or your phone's app settings), then try again.",
      );
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function cancelRecording() {
    cancelledRef.current = true;
    mediaRecorderRef.current?.stop();
  }

  async function saveText() {
    const transcript = textValue.trim();
    if (!transcript) return;
    await addPendingCapture({
      localId: crypto.randomUUID(),
      captureMode: "text",
      transcript,
      capturedAt: Date.now(),
    });
    void syncPendingCaptures();
    await clearDraftText();
    setTextValue("");
    setTextSaved(true);
    setTimeout(() => setTextSaved(false), 1200);
    textareaRef.current?.focus();
  }

  if (view === "text") {
    return (
      <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
        <div className="flex justify-end">
          <button
            onClick={() => setView("voice-idle")}
            aria-label="Back to voice capture"
            className="rounded-full p-3 text-beaver hover:text-neutral-100"
          >
            <MicIcon />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          // ⌘/Ctrl+Enter saves; a plain Enter is still a newline.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void saveText();
            }
          }}
          placeholder="What's on your mind..."
          className="mt-4 flex-1 resize-none bg-transparent text-lg outline-none placeholder:text-beaver"
        />
        <button
          onClick={saveText}
          disabled={!textValue.trim()}
          className="mt-4 rounded-lg bg-gold py-3 font-medium text-jungle disabled:opacity-30"
        >
          {textSaved ? "Saved ✓" : "Save"}
        </button>
      </main>
    );
  }

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-4 bg-jungle p-6">
      <div className="absolute left-6 top-6 flex flex-col items-start gap-0.5">
        <Link
          href="/inbox"
          aria-label="Open inbox"
          className="flex items-center gap-1.5 rounded-full p-3 text-beaver hover:text-gold"
        >
          <InboxIcon />
          {untriagedCount !== undefined && untriagedCount.count > 0 && (
            <span className="text-sm">{formatCount(untriagedCount)}</span>
          )}
        </Link>
        {syncCounts.waiting > 0 && (
          <span className="pl-2 text-xs text-beaver">{syncCounts.waiting} pending sync</span>
        )}
        {/* Plain text, not an alert — no red badges per the README. The detail
            and the discard live in Settings, keeping Record to one action. */}
        {syncCounts.stuck > 0 && (
          <Link href="/settings#stuck-captures" className="inline-flex min-h-11 items-center pl-2 text-xs text-beaver underline hover:text-gold">
            {syncCounts.stuck === 1 ? "1 capture couldn't sync" : `${syncCounts.stuck} captures couldn't sync`}
          </Link>
        )}
      </div>

      <h1 className="font-heading absolute top-6 left-1/2 -translate-x-1/2 text-4xl text-gold">
        Loose Change
      </h1>

      <button
        onClick={() => setView("text")}
        aria-label="Switch to text capture"
        className="absolute right-6 top-6 rounded-full p-3 text-beaver hover:text-gold"
      >
        <KeyboardIcon />
      </button>

      <button
        onClick={view === "voice-recording" ? stopRecording : startRecording}
        aria-label={view === "voice-recording" ? "Stop recording" : "Start recording"}
        className={`flex h-32 w-32 items-center justify-center rounded-full text-neutral-100 transition-colors ${
          view === "voice-recording"
            ? "bg-engineering motion-safe:animate-pulse"
            : view === "saved"
              ? "bg-gold text-jungle"
              : "bg-olive hover:bg-beaver"
        }`}
      >
        {view === "saved" ? (
          <CheckIcon />
        ) : view === "voice-recording" ? (
          <StopIcon />
        ) : (
          <MicIcon size={40} />
        )}
      </button>

      {view === "voice-recording" && <RecordingTimer />}

      {view === "voice-recording" && (
        <button
          onClick={cancelRecording}
          aria-label="Cancel recording without saving"
          className="flex items-center gap-1.5 rounded-full p-3 text-sm text-beaver hover:text-engineering"
        >
          <XIcon size={16} />
          Cancel
        </button>
      )}

      {view === "saved" && <p className="text-sm text-gold">Saved ✓</p>}
      {micError && (
        <div role="alert" className="flex max-w-sm flex-col items-center gap-2 text-center">
          <p className="text-sm text-engineering">{micError}</p>
          <button
            onClick={startRecording}
            className="min-h-11 rounded-lg border border-olive px-4 text-sm text-beaver hover:text-gold"
          >
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
