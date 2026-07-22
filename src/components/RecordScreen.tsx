"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { addPendingCapture } from "@/lib/offlineQueue";
import { syncPendingCaptures } from "@/lib/syncEngine";
import { MicIcon, StopIcon, CheckIcon, KeyboardIcon, InboxIcon } from "@/components/icons";

type View = "voice-idle" | "voice-recording" | "saved" | "text";

export function RecordScreen() {
  const untriagedCount = useQuery(api.entries.getUntriagedCount);
  const [view, setView] = useState<View>("voice-idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [textValue, setTextValue] = useState("");
  const [textSaved, setTextSaved] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (view === "text") textareaRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (view !== "saved") return;
    const timer = setTimeout(() => setView("voice-idle"), 1200);
    return () => clearTimeout(timer);
  }, [view]);

  async function startRecording() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        stream.getTracks().forEach((track) => track.stop());
        await addPendingCapture({
          localId: crypto.randomUUID(),
          captureMode: "voice",
          audioBlob: blob,
          capturedAt: Date.now(),
        });
        void syncPendingCaptures();
        setView("saved");
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setView("voice-recording");
    } catch {
      setMicError("Microphone access needed to record.");
    }
  }

  function stopRecording() {
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
    setTextValue("");
    setTextSaved(true);
    setTimeout(() => setTextSaved(false), 1200);
    textareaRef.current?.focus();
  }

  if (view === "text") {
    return (
      <main className="flex flex-1 flex-col bg-neutral-950 p-6 text-neutral-100">
        <div className="flex justify-end">
          <button
            onClick={() => setView("voice-idle")}
            aria-label="Back to voice capture"
            className="rounded-full p-2 text-neutral-400 hover:text-neutral-100"
          >
            <MicIcon />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder="What's on your mind..."
          className="mt-4 flex-1 resize-none bg-transparent text-lg outline-none placeholder:text-neutral-600"
        />
        <button
          onClick={saveText}
          disabled={!textValue.trim()}
          className="mt-4 rounded-lg bg-neutral-100 py-3 font-medium text-neutral-950 disabled:opacity-30"
        >
          {textSaved ? "Saved ✓" : "Save"}
        </button>
      </main>
    );
  }

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <Link
        href="/inbox"
        aria-label="Open inbox"
        className="absolute left-6 top-6 flex items-center gap-1.5 rounded-full p-2 text-neutral-400 hover:text-neutral-600"
      >
        <InboxIcon />
        {untriagedCount !== undefined && untriagedCount > 0 && (
          <span className="text-sm">{untriagedCount}</span>
        )}
      </Link>

      <button
        onClick={() => setView("text")}
        aria-label="Switch to text capture"
        className="absolute right-6 top-6 rounded-full p-2 text-neutral-400 hover:text-neutral-600"
      >
        <KeyboardIcon />
      </button>

      <button
        onClick={view === "voice-recording" ? stopRecording : startRecording}
        aria-label={view === "voice-recording" ? "Stop recording" : "Start recording"}
        className={`flex h-32 w-32 items-center justify-center rounded-full transition-colors ${
          view === "voice-recording"
            ? "animate-pulse bg-red-500"
            : view === "saved"
              ? "bg-green-500"
              : "bg-neutral-800 hover:bg-neutral-700"
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

      {view === "saved" && <p className="text-sm text-neutral-500">Saved ✓</p>}
      {micError && <p className="text-sm text-red-500">{micError}</p>}
    </main>
  );
}
