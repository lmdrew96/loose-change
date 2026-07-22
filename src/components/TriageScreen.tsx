"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeftIcon, MicIcon, KeyboardIcon, ChatBubbleIcon, PlayIcon, PauseIcon } from "@/components/icons";

export function TriageScreen() {
  const { isAuthenticated } = useConvexAuth();
  const { results, status, loadMore } = usePaginatedQuery(
    api.entries.listInbox,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 1 },
  );
  const entry = results[0];

  // A page can reactively shrink to zero items (e.g. the entry we just kept/
  // discarded no longer matches) while more untriaged entries still exist
  // further down the index — Convex signals this as canLoadMore with an
  // empty page rather than auto-advancing. Keep pulling until we land on a
  // real entry or genuinely exhaust the query.
  useEffect(() => {
    if (status === "CanLoadMore" && results.length === 0) {
      loadMore(1);
    }
  }, [status, results.length, loadMore]);

  const loading =
    status === "LoadingFirstPage" || status === "LoadingMore" || (status === "CanLoadMore" && results.length === 0);

  const keepEntry = useMutation(api.entries.keepEntry);
  const discardEntry = useMutation(api.entries.discardEntry);
  const undoDiscard = useMutation(api.entries.undoDiscard);
  const markPromoted = useMutation(api.entries.markPromoted);

  const [undoTarget, setUndoTarget] = useState<{ entryId: Id<"entries"> } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Swipe (right = Keep, left = Discard) alongside the four buttons, which
  // stay as the explicit fallback affordance.
  const SWIPE_THRESHOLD = 80;
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState<"keep" | "discard" | null>(null);
  const dragStartX = useRef<number | null>(null);

  useEffect(() => {
    setDragX(0);
    setFlying(null);
    dragStartX.current = null;
  }, [entry?._id]);

  function onCardPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (flying) return;
    dragStartX.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onCardPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartX.current === null) return;
    setDragX(e.clientX - dragStartX.current);
  }

  function onCardPointerUp() {
    if (dragStartX.current === null) return;
    dragStartX.current = null;
    setDragging(false);
    if (dragX > SWIPE_THRESHOLD) {
      setFlying("keep");
      setTimeout(() => void handleKeep(), 180);
    } else if (dragX < -SWIPE_THRESHOLD) {
      setFlying("discard");
      setTimeout(() => void handleDiscard(), 180);
    } else {
      setDragX(0);
    }
  }

  function flashToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleKeep() {
    if (!entry) return;
    await keepEntry({ entryId: entry._id });
  }

  async function handleDiscard() {
    if (!entry) return;
    const entryId = entry._id;
    await discardEntry({ entryId });
    setUndoTarget({ entryId });
    setTimeout(() => setUndoTarget((current) => (current?.entryId === entryId ? null : current)), 6000);
  }

  async function handleUndo() {
    if (!undoTarget) return;
    await undoDiscard({ entryId: undoTarget.entryId });
    setUndoTarget(null);
  }

  async function handleSendTo(destination: "kindling" | "controlledchaos") {
    if (!entry?.transcript) return;
    await navigator.clipboard.writeText(entry.transcript);
    await markPromoted({ entryId: entry._id, destination });
    flashToast(`Copied — paste into ${destination === "kindling" ? "Kindling" : "ControlledChaos"}`);
  }

  // Batch-triage speedup for desktop sessions (README frames Triage as a
  // batch/later activity). No text inputs live on this screen, so no need to
  // guard against typing focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "k" || e.key === "K") void handleKeep();
      else if (e.key === "d" || e.key === "D") void handleDiscard();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/inbox" aria-label="Back to inbox" className="rounded-full p-2 text-beaver hover:text-gold">
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-heading text-2xl">Triage</h1>
        <span className="w-5" />
      </header>

      <div className="flex flex-1 items-center justify-center">
        {loading ? (
          <p className="text-sm text-beaver">Loading…</p>
        ) : !entry ? (
          <p className="text-sm text-beaver">Nothing left to triage.</p>
        ) : (
          <div
            onPointerDown={onCardPointerDown}
            onPointerMove={onCardPointerMove}
            onPointerUp={onCardPointerUp}
            onPointerCancel={onCardPointerUp}
            style={{
              transform: `translateX(${flying === "keep" ? 400 : flying === "discard" ? -400 : dragX}px) rotate(${
                (flying === "keep" ? 400 : flying === "discard" ? -400 : dragX) / 20
              }deg)`,
              opacity: flying ? 0 : 1,
              transition: dragging ? "none" : "transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease",
            }}
            className={`w-full max-w-md cursor-grab touch-none rounded-lg border p-6 active:cursor-grabbing ${
              dragX > SWIPE_THRESHOLD / 2 || flying === "keep"
                ? "border-gold"
                : dragX < -SWIPE_THRESHOLD / 2 || flying === "discard"
                  ? "border-engineering"
                  : "border-olive"
            }`}
          >
            <div className="mb-3 flex items-center gap-2 text-beaver">
              {entry.captureMode === "voice" ? (
                <MicIcon size={16} />
              ) : entry.captureMode === "text" ? (
                <KeyboardIcon size={16} />
              ) : (
                <ChatBubbleIcon size={16} />
              )}
              <span className="text-xs">{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap text-base">
              {entry.transcript ??
                (entry.transcriptionStatus === "failed"
                  ? "(couldn't transcribe — audio available)"
                  : "Transcribing…")}
            </p>
            {entry.captureMode === "voice" && entry.audioUrl && (
              <AudioPlayer key={entry._id} src={entry.audioUrl} />
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={handleKeep}
          disabled={!entry}
          className="rounded-lg bg-gold py-3 text-sm font-medium text-jungle disabled:opacity-30"
        >
          Keep
        </button>
        <button
          onClick={handleDiscard}
          disabled={!entry}
          className="rounded-lg bg-engineering py-3 text-sm text-white disabled:opacity-30"
        >
          Discard
        </button>
        <button
          onClick={() => handleSendTo("kindling")}
          disabled={!entry?.transcript}
          className="rounded-lg bg-olive py-3 text-sm text-white disabled:opacity-30"
        >
          Kindling
        </button>
        <button
          onClick={() => handleSendTo("controlledchaos")}
          disabled={!entry?.transcript}
          className="rounded-lg bg-olive py-3 text-sm text-white disabled:opacity-30"
        >
          → CC
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-beaver">K keep · D discard</p>

      {undoTarget && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-24 z-50 mx-auto flex w-fit items-center gap-3 rounded-full bg-olive px-4 py-2 text-sm text-white"
        >
          <span>Discarded</span>
          <button onClick={handleUndo} className="font-medium text-gold underline">
            Undo
          </button>
        </div>
      )}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-full bg-olive px-4 py-2 text-sm text-white"
        >
          {toast}
        </div>
      )}
    </main>
  );
}

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  }

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setProgress(audio.currentTime / audio.duration);
  }

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const ratio = Number(e.target.value);
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
        className="hidden"
      />
      <button
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-jungle"
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        onChange={onScrub}
        aria-label="Seek"
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-olive accent-gold"
      />
    </div>
  );
}
