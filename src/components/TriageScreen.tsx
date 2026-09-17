"use client";

import { useEffect, useRef, useState } from "react";
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { MicIcon, KeyboardIcon, ChatBubbleIcon } from "@/components/icons";
import { AudioPlayer } from "@/components/AudioPlayer";
import { transcriptPlaceholder } from "@/components/EntryCard";
import { useEntryActions } from "@/components/useEntryActions";
import { DESTINATIONS, destinationLabel, type Destination } from "@/lib/labels";
import { formatCount } from "@/lib/format";

export function TriageScreen() {
  const { isAuthenticated } = useConvexAuth();
  const { results, status, loadMore } = usePaginatedQuery(
    api.entries.listInbox,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 1 },
  );

  // Position is tracked explicitly rather than always reading results[0],
  // because Skip has to advance without mutating anything. Triaging an entry
  // still removes it from the query reactively, which shifts the next entry
  // into the current index on its own — so cursor only ever moves on Skip.
  const [cursor, setCursor] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const entry = results[cursor];
  const untriagedCount = useQuery(api.entries.getUntriagedCount, isAuthenticated ? {} : "skip");
  // Makes the batch feel finite. Skipped entries are still untriaged, so
  // they're taken off — "left" means left to look at this session. A capped
  // count can't be meaningfully reduced, so it's shown as-is ("500+ left").
  const leftLabel =
    untriagedCount === undefined
      ? null
      : untriagedCount.capped
        ? formatCount(untriagedCount)
        : untriagedCount.count - skipped > 0
          ? String(untriagedCount.count - skipped)
          : null;

  // Covers both "skipped past the end of what's loaded" and the case where a
  // page reactively shrinks out from under us (the entry we just kept no
  // longer matches the query, but more untriaged entries exist further down
  // the index — Convex reports CanLoadMore with a short page rather than
  // auto-advancing). One trigger for both, so they can't fight.
  useEffect(() => {
    if (cursor >= results.length && status === "CanLoadMore") loadMore(1);
  }, [cursor, results.length, status, loadMore]);

  const loading =
    status === "LoadingFirstPage" ||
    status === "LoadingMore" ||
    (cursor >= results.length && status === "CanLoadMore");

  const markPromoted = useMutation(api.entries.markPromoted);
  const { keep, discard, offerUndoToInbox, runAction, showToast } = useEntryActions();
  const [showAllDestinations, setShowAllDestinations] = useState(false);

  // Deliberately does not mutate: a skipped entry stays untriaged and comes
  // back next session. Being able to say "not now" is the whole point — one
  // undecidable entry used to block everything behind it.
  function handleSkip() {
    if (!entry) return;
    setCursor((c) => c + 1);
    setSkipped((n) => n + 1);
  }

  // Every decision here gets the same Undo. Keep and Send used to commit
  // silently, and nothing could put an entry back in the Inbox afterwards.
  async function handleKeep() {
    if (!entry) return;
    await keep(entry._id, { undoable: true });
  }

  async function handleDiscard() {
    if (!entry) return;
    await discard(entry._id);
  }

  async function handleSendTo(destination: Destination) {
    if (!entry?.transcript) return;
    const entryId = entry._id;
    const label = destinationLabel(destination);

    // The clipboard IS the handoff to the other app, so a failed copy must not
    // mark the entry promoted — and must not fail silently either. writeText
    // rejects on a non-secure context, a denied permission, or an iOS Safari
    // gesture-window miss, and an unhandled rejection here just looks like a
    // dead button.
    try {
      await navigator.clipboard.writeText(entry.transcript);
    } catch {
      showToast({ message: `Couldn't copy to clipboard — ${label} wasn't updated` });
      return;
    }

    // The text is already on the clipboard, so say that too — otherwise a
    // failed mark reads as if the whole send failed.
    const result = await runAction(`Copied, but couldn't mark it sent to ${label} — try again.`, () =>
      markPromoted({ entryId, destination }),
    );
    if (result.ok) offerUndoToInbox(entryId, `Copied — paste into ${label}`);
  }

  // Batch-triage speedup for desktop sessions (README frames Triage as a
  // batch/later activity). No text inputs live on this screen, so no need to
  // guard against typing focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "k" || e.key === "K") void handleKeep();
      else if (e.key === "d" || e.key === "D") void handleDiscard();
      else if (e.key === "s" || e.key === "S") handleSkip();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="font-heading text-2xl">Triage</h1>
        {leftLabel && <span className="text-sm text-beaver">{leftLabel} left</span>}
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {loading ? (
          <p className="text-sm text-beaver">Loading…</p>
        ) : !entry ? (
          <div className="text-center">
            <p className="text-sm text-beaver">
              {skipped > 0 ? "That's everything else." : "Nothing left to triage."}
            </p>
            {skipped > 0 && (
              <>
                <p className="mt-1 text-sm text-beaver">
                  {skipped === 1 ? "1 skipped entry is" : `${skipped} skipped entries are`} still in
                  your inbox.
                </p>
                <button
                  onClick={() => {
                    setCursor(0);
                    setSkipped(0);
                  }}
                  className="mt-3 min-h-11 px-2 text-sm text-gold underline"
                >
                  Go back through them
                </button>
              </>
            )}
          </div>
        ) : (
          /* Keyed on the entry id so React remounts on advance — that resets
             the card's drag state for free, instead of an effect reaching in
             to zero it out after the fact. */
          <TriageCard
            key={entry._id}
            entry={entry}
            onKeep={handleKeep}
            onDiscard={handleDiscard}
          />
        )}
      </div>

      {/* Two by two on a phone so "ControlledChaos" fits unabbreviated; one
          row on wider screens. The order — and so each action's position —
          is the same either way. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          onClick={handleKeep}
          disabled={!entry}
          className="min-h-12 rounded-lg bg-gold text-sm font-medium text-jungle disabled:opacity-30"
        >
          Keep
        </button>
        <button
          onClick={handleDiscard}
          disabled={!entry}
          className="min-h-12 rounded-lg bg-engineering text-sm text-white disabled:opacity-30"
        >
          Discard
        </button>
        {DESTINATIONS.filter((d) => d.primary).map((d) => (
          <button
            key={d.id}
            onClick={() => handleSendTo(d.id)}
            disabled={!entry?.transcript}
            className="min-h-12 rounded-lg bg-olive text-sm text-white disabled:opacity-30"
          >
            {d.label}
          </button>
        ))}
      </div>
      {/* The other destinations lc_mark_promoted accepts. Behind a toggle so
          the four primary actions keep their fixed positions, but nothing the
          MCP tool can record is unreachable from the app. */}
      {showAllDestinations && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {DESTINATIONS.filter((d) => !d.primary).map((d) => (
            <button
              key={d.id}
              onClick={() => handleSendTo(d.id)}
              disabled={!entry?.transcript}
              className="min-h-11 rounded-lg border border-olive text-sm text-beaver hover:text-gold disabled:opacity-30"
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-center gap-4">
        <button
          onClick={handleSkip}
          disabled={!entry}
          className="min-h-11 rounded-full px-4 text-sm text-beaver hover:text-gold disabled:opacity-30"
        >
          Skip for now →
        </button>
        <button
          onClick={() => setShowAllDestinations((v) => !v)}
          aria-expanded={showAllDestinations}
          className="min-h-11 rounded-full px-4 text-sm text-beaver hover:text-gold"
        >
          {showAllDestinations ? "Fewer destinations" : "More destinations"}
        </button>
      </div>
      {/* Keyboard shortcuts only mean anything with a keyboard. */}
      <p className="mt-1 hidden text-center text-xs text-beaver sm:block">K keep · D discard · S skip</p>
    </main>
  );
}

type TriageEntry = Doc<"entries"> & { audioUrl: string | null };

// Swipe right = Keep, left = Discard, alongside the four buttons which stay as
// the explicit fallback affordance. Drag state lives here rather than in the
// parent so remounting on a new entry resets it — see the key at the call site.
const SWIPE_THRESHOLD = 80;

function TriageCard({
  entry,
  onKeep,
  onDiscard,
}: {
  entry: TriageEntry;
  onKeep: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState<"keep" | "discard" | null>(null);
  const dragStartX = useRef<number | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (flying) return;
    dragStartX.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartX.current === null) return;
    setDragX(e.clientX - dragStartX.current);
  }

  function onPointerUp() {
    if (dragStartX.current === null) return;
    dragStartX.current = null;
    setDragging(false);
    if (dragX > SWIPE_THRESHOLD) {
      setFlying("keep");
      setTimeout(() => void onKeep(), 180);
    } else if (dragX < -SWIPE_THRESHOLD) {
      setFlying("discard");
      setTimeout(() => void onDiscard(), 180);
    } else {
      setDragX(0);
    }
  }

  const offset = flying === "keep" ? 400 : flying === "discard" ? -400 : dragX;
  const intent =
    dragX > SWIPE_THRESHOLD / 2 || flying === "keep"
      ? "keep"
      : dragX < -SWIPE_THRESHOLD / 2 || flying === "discard"
        ? "discard"
        : null;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        transform: `translateX(${offset}px) rotate(${offset / 20}deg)`,
        opacity: flying ? 0 : 1,
        transition: dragging ? "none" : "transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease",
      }}
      // touch-pan-y rather than touch-none: the browser keeps vertical
      // scrolling (so a long transcript is readable) while horizontal panning
      // stays ours. Pointer events still fire either way, so swipe works
      // across the whole card — including the transcript, which is most of
      // it. Stopping propagation on the text instead would have made the
      // biggest target un-swipeable.
      //
      // The cap is viewport-relative, not max-h-full: body is min-h-full (so
      // list screens can grow and scroll the page), which doesn't give a
      // definite height for a percentage cap to resolve against. The cap
      // leaves room for the header, the action grid, the Skip affordance and
      // the nav bar without any of them going below the fold — lower on a
      // phone, where the grid takes two rows.
      className={`flex max-h-[50vh] w-full max-w-md sm:max-h-[60vh] cursor-grab touch-pan-y flex-col rounded-lg border p-6 active:cursor-grabbing ${
        intent === "keep" ? "border-gold" : intent === "discard" ? "border-engineering" : "border-olive"
      }`}
    >
      {/* Colour alone carried the swipe intent, which is both a
          colour-blindness problem (gold vs red on dark green) and the only
          thing that made the gesture discoverable at all. */}
      <div
        aria-hidden
        className={`mb-2 h-5 text-sm font-medium transition-opacity ${
          intent === "keep"
            ? "text-gold opacity-100"
            : intent === "discard"
              ? "text-engineering opacity-100"
              : "opacity-0"
        }`}
      >
        {intent === "keep" ? "Keep →" : intent === "discard" ? "← Discard" : ""}
      </div>
      <div className="mb-3 flex shrink-0 items-center gap-2 text-beaver">
        {entry.captureMode === "voice" ? (
          <MicIcon size={16} />
        ) : entry.captureMode === "text" ? (
          <KeyboardIcon size={16} />
        ) : (
          <ChatBubbleIcon size={16} />
        )}
        <span className="text-xs">{new Date(entry.createdAt).toLocaleString()}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="whitespace-pre-wrap text-base">
          {entry.transcript ?? transcriptPlaceholder(entry.transcriptionStatus)}
        </p>
      </div>
      {entry.captureMode === "voice" && entry.audioUrl && (
        <div className="shrink-0">
          <AudioPlayer src={entry.audioUrl} />
        </div>
      )}
    </div>
  );
}
