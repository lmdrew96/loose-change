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
  saveDraftText,
  startInProgressRecording,
  subscribePendingCaptures,
} from "@/lib/offlineQueue";
import { syncPendingCaptures } from "@/lib/syncEngine";
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

export function RecordScreen() {
  const { isAuthenticated } = useConvexAuth();
  const untriagedCount = useQuery(api.entries.getUntriagedCount, isAuthenticated ? {} : "skip");
  const [view, setView] = useState<View>("voice-idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [textValue, setTextValue] = useState("");
  const [textSaved, setTextSaved] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pendingAppendsRef = useRef<Promise<void>[]>([]);
  const recordingLocalIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Reflects captures still sitting in IndexedDB — either waiting for the
  // network or stuck on a sync that keeps failing (syncEngine only
  // console.errors those, so this is the one visible signal of that).
  useEffect(() => {
    function refresh() {
      void getPendingCaptures().then((captures) => setPendingCount(captures.length));
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
          void syncPendingCaptures();
          setView("saved");
        } else {
          setView("voice-idle");
        }
      };
      recorder.start(RECORDING_TIMESLICE_MS);
      mediaRecorderRef.current = recorder;
      setView("voice-recording");
    } catch {
      setMicError("Microphone access needed to record.");
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
            className="rounded-full p-2 text-beaver hover:text-neutral-100"
          >
            <MicIcon />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
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
          {untriagedCount !== undefined && untriagedCount > 0 && (
            <span className="text-sm">{untriagedCount}</span>
          )}
        </Link>
        {pendingCount > 0 && (
          <span className="pl-2 text-xs text-beaver">{pendingCount} pending sync</span>
        )}
      </div>

      <h1 className="font-heading absolute top-6 left-1/2 -translate-x-1/2 text-3xl text-gold">
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
            ? "animate-pulse bg-engineering"
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
      {micError && <p className="text-sm text-engineering">{micError}</p>}
    </main>
  );
}
