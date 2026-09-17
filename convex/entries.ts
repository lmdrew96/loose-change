import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId, requireMcpSecret } from "./authHelpers";

// Ceiling on the count/stats queries. Both exist to display a number, not to
// return rows, so past this point an exact figure isn't worth an unbounded
// scan — they report `capped: true` and the UI renders "500+". Convex caps a
// single function's reads, and this app is designed to accumulate forever.
const COUNT_CAP = 500;

// Ecosystem apps a capture can be handed off to. lc_mark_promoted only
// records where it went — the destination app's own MCP does the actual write.
const promotedToValidator = v.union(
      v.literal("kindling"),
      v.literal("controlledchaos"),
      v.literal("threadnotes"),
      v.literal("tangle"),
      v.literal("chaospatch"),
    );

type PromotedTo =
  | "kindling"
  | "controlledchaos"
  | "threadnotes"
  | "tangle"
  | "chaospatch";

async function requireOwnedEntry(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  entryId: Id<"entries">,
): Promise<Doc<"entries">> {
  const entry = await ctx.db.get(entryId);
  if (!entry || entry.userId !== userId) throw new Error("Entry not found");
  return entry;
}

// ── Shared handlers (called from both the Clerk-authed and MCP-authed paths) ─

// A capture already synced under this localId, if any. Sync retries after a
// lost response are the expected caller — see schema.ts.
async function findByLocalId(
  ctx: MutationCtx,
  userId: string,
  localId: string | undefined,
): Promise<Doc<"entries"> | null> {
  if (localId === undefined) return null;
  return await ctx.db
    .query("entries")
    .withIndex("by_user_localId", (q) => q.eq("userId", userId).eq("localId", localId))
    .unique();
}

async function createTextEntryHandler(
  ctx: MutationCtx,
  userId: string,
  args: { transcript: string; capturedAt: number; captureMode: "text" | "chat"; localId?: string },
) {
  const existing = await findByLocalId(ctx, userId, args.localId);
  if (existing) return existing._id;

  return await ctx.db.insert("entries", {
    userId,
    captureMode: args.captureMode,
    transcript: args.transcript,
    audioStorageId: null,
    transcriptionStatus: "n/a",
    status: "untriaged",
    promotedTo: null,
    discardedAt: null,
    audioDeletedAt: null,
    localId: args.localId,
    createdAt: args.capturedAt,
  });
}

async function listByStatusHandler(
  ctx: QueryCtx,
  userId: string,
  status: Doc<"entries">["status"],
  paginationOpts: { numItems: number; cursor: string | null },
) {
  const result = await ctx.db
    .query("entries")
    .withIndex("by_user_status_createdAt", (q) => q.eq("userId", userId).eq("status", status))
    .order("desc")
    .paginate(paginationOpts);

  const page = await Promise.all(
    result.page.map(async (entry) => ({
      ...entry,
      audioUrl: entry.audioStorageId ? await ctx.storage.getUrl(entry.audioStorageId) : null,
    })),
  );

  return { ...result, page };
}

async function listInboxHandler(
  ctx: QueryCtx,
  userId: string,
  paginationOpts: { numItems: number; cursor: string | null },
) {
  return await listByStatusHandler(ctx, userId, "untriaged", paginationOpts);
}

const ALL_STATUSES = ["untriaged", "kept", "discarded", "promoted"] as const;

async function getStatsHandler(ctx: QueryCtx, userId: string) {
  // One capped range per status rather than one collect() over the user's
  // entire history — the old version was the largest scan in the codebase.
  const stats = { untriaged: 0, kept: 0, discarded: 0, promoted: 0, capped: false };
  for (const status of ALL_STATUSES) {
    const rows = await ctx.db
      .query("entries")
      .withIndex("by_user_status_createdAt", (q) => q.eq("userId", userId).eq("status", status))
      .take(COUNT_CAP + 1);
    stats[status] = Math.min(rows.length, COUNT_CAP);
    if (rows.length > COUNT_CAP) stats.capped = true;
  }
  return stats;
}

async function keepHandler(ctx: MutationCtx, userId: string, entryId: Id<"entries">) {
  await requireOwnedEntry(ctx, userId, entryId);
  await ctx.db.patch(entryId, { status: "kept", triagedAt: Date.now() });
}

async function discardHandler(ctx: MutationCtx, userId: string, entryId: Id<"entries">) {
  const entry = await requireOwnedEntry(ctx, userId, entryId);
  const discardedFromStatus: "untriaged" | "kept" | "promoted" =
    entry.status === "discarded" ? "untriaged" : entry.status;
  const now = Date.now();
  await ctx.db.patch(entryId, {
    status: "discarded",
    discardedAt: now,
    discardedFromStatus,
    triagedAt: now,
  });
}

async function undoDiscardHandler(ctx: MutationCtx, userId: string, entryId: Id<"entries">) {
  const entry = await requireOwnedEntry(ctx, userId, entryId);
  if (entry.status !== "discarded") throw new Error("Entry is not discarded");
  const restoredStatus = entry.discardedFromStatus ?? "untriaged";
  await ctx.db.patch(entryId, {
    status: restoredStatus,
    discardedAt: null,
    discardedFromStatus: undefined,
    // Back in the untriaged pool means audio is retained indefinitely, so the
    // retention clock is cleared. Restoring to a still-triaged status instead
    // restarts that clock — undoing a mistake shouldn't cost you the audio
    // just because the original triage was 29 days ago.
    triagedAt: restoredStatus === "untriaged" ? undefined : Date.now(),
  });
  return restoredStatus;
}

// The way back from any decision. Keep and Send had no undo and nothing could
// return an entry to the untriaged pool, so a thumb-slip in Triage was
// permanent. A discarded entry is accepted too (its discard bookkeeping is
// cleared) so callers don't have to know which undo applies.
async function returnToInboxHandler(ctx: MutationCtx, userId: string, entryId: Id<"entries">) {
  const entry = await requireOwnedEntry(ctx, userId, entryId);
  if (entry.status === "untriaged") return;
  await ctx.db.patch(entryId, {
    status: "untriaged",
    promotedTo: null,
    discardedAt: null,
    discardedFromStatus: undefined,
    // Untriaged entries keep their audio indefinitely — same as undoDiscard.
    triagedAt: undefined,
  });
}

// Editable only once there's text. A voice memo still transcribing has
// nothing to correct yet, and a webhook landing afterwards must not overwrite
// the correction (see setTranscript).
function canEditTranscript(entry: Doc<"entries">): entry is Doc<"entries"> & { transcript: string } {
  return entry.transcript !== null && entry.transcriptionStatus !== "pending";
}

async function updateTranscriptHandler(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"entries">,
  transcript: string,
) {
  const entry = await requireOwnedEntry(ctx, userId, entryId);
  const text = transcript.trim();
  if (text === "") throw new Error("A transcript can't be empty");
  if (!canEditTranscript(entry)) throw new Error("There's no transcript to edit yet");
  if (text === entry.transcript) return;

  const original = entry.originalTranscript ?? entry.transcript;
  await ctx.db.patch(entryId, {
    transcript: text,
    // Editing it back to exactly what was captured is the same as reverting.
    originalTranscript: text === original ? undefined : original,
  });
}

async function revertTranscriptHandler(ctx: MutationCtx, userId: string, entryId: Id<"entries">) {
  const entry = await requireOwnedEntry(ctx, userId, entryId);
  if (entry.originalTranscript === undefined) throw new Error("This transcript hasn't been edited");
  await ctx.db.patch(entryId, { transcript: entry.originalTranscript, originalTranscript: undefined });
}

async function markPromotedHandler(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"entries">,
  destination: PromotedTo,
) {
  await requireOwnedEntry(ctx, userId, entryId);
  await ctx.db.patch(entryId, { status: "promoted", promotedTo: destination, triagedAt: Date.now() });
}

// Only a timeout is retryable. "failed" covers bad keys, API errors and
// undecodable audio, none of which a re-run fixes — and the README's stance
// that a garbled transcript's fallback is the audio, not a re-run, still holds.
async function retryTranscriptionHandler(ctx: MutationCtx, userId: string, entryId: Id<"entries">) {
  const entry = await requireOwnedEntry(ctx, userId, entryId);
  if (entry.transcriptionStatus !== "timed_out") {
    throw new Error("Only a transcription that timed out can be retried");
  }
  // Retention may have cleared the blob since the timeout; with nothing to
  // transcribe, the action would just mark it failed.
  if (entry.audioStorageId === null) throw new Error("Audio is no longer available to transcribe");
  await ctx.db.patch(entryId, { transcriptionStatus: "pending", transcriptionRequestedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.transcription.transcribeEntry, { entryId });
}

async function searchHandler(
  ctx: QueryCtx,
  userId: string,
  searchQuery: string,
  status: Doc<"entries">["status"] | undefined,
  limit: number,
) {
  const search = ctx.db.query("entries").withSearchIndex("search_transcript", (q) => {
    const base = q.search("transcript", searchQuery).eq("userId", userId);
    return status ? base.eq("status", status) : base;
  });
  const results = await search.take(limit);

  // Same shape as the list queries, so a search hit can be rendered by the
  // same card — including playing its audio back.
  return await Promise.all(
    results.map(async (entry) => ({
      ...entry,
      audioUrl: entry.audioStorageId ? await ctx.storage.getUrl(entry.audioStorageId) : null,
    })),
  );
}

// ── Client-facing functions (Clerk auth) ─────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createTextEntry = mutation({
  args: {
    transcript: v.string(),
    capturedAt: v.number(),
    captureMode: v.union(v.literal("text"), v.literal("chat")),
    localId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await createTextEntryHandler(ctx, userId, args);
  },
});

export const createVoiceEntry = mutation({
  args: {
    audioStorageId: v.id("_storage"),
    capturedAt: v.number(),
    localId: v.optional(v.string()),
  },
  handler: async (ctx, { audioStorageId, capturedAt, localId }) => {
    const userId = await requireUserId(ctx);

    const existing = await findByLocalId(ctx, userId, localId);
    if (existing) {
      // A retry re-uploads the blob before calling this, so the one we were
      // just handed is a second copy of audio the original entry already
      // references. Drop it rather than orphaning it in storage.
      if (existing.audioStorageId !== audioStorageId) await ctx.storage.delete(audioStorageId);
      return existing._id;
    }

    const entryId = await ctx.db.insert("entries", {
      userId,
      captureMode: "voice",
      transcript: null,
      audioStorageId,
      transcriptionStatus: "pending",
      transcriptionRequestedAt: Date.now(),
      status: "untriaged",
      promotedTo: null,
      discardedAt: null,
      audioDeletedAt: null,
      localId,
      createdAt: capturedAt,
    });
    await ctx.scheduler.runAfter(0, internal.transcription.transcribeEntry, { entryId });
    return entryId;
  },
});

export const getTranscriptionJob = internalQuery({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.audioStorageId === null) return null;
    const audioUrl = await ctx.storage.getUrl(entry.audioStorageId);
    if (!audioUrl) return null;
    return { audioUrl, jobId: entry.transcriptionJobId };
  },
});

// The webhook's entry id comes from a URL, so it's validated here rather than
// trusted. Only an entry still waiting on this exact job gets a transcript.
export const getEntryAwaitingTranscript = internalQuery({
  args: { entryId: v.string(), jobId: v.string() },
  handler: async (ctx, { entryId, jobId }) => {
    const id = ctx.db.normalizeId("entries", entryId);
    if (!id) return null;
    const entry = await ctx.db.get(id);
    if (!entry) return null;
    if (entry.transcriptionStatus !== "pending" && entry.transcriptionStatus !== "timed_out") return null;
    // The user has already corrected the text by hand; a late result loses.
    if (entry.originalTranscript !== undefined) return null;
    // Undefined when the webhook beat setTranscriptionJobId to the commit.
    if (entry.transcriptionJobId !== undefined && entry.transcriptionJobId !== jobId) return null;
    return id;
  },
});

export const setTranscriptionJobId = internalMutation({
  args: { entryId: v.id("entries"), jobId: v.string() },
  handler: async (ctx, { entryId, jobId }) => {
    await ctx.db.patch(entryId, { transcriptionJobId: jobId });
  },
});

export const setTranscriptionTimedOut = internalMutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    // The stale sweep's job check can race a webhook that just finished. A
    // transcript that already landed must not be flipped back to retryable.
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.transcriptionStatus !== "pending") return;
    await ctx.db.patch(entryId, { transcriptionStatus: "timed_out" });
  },
});

// AssemblyAI normally finishes well inside this, even for long memos.
export const STALE_TRANSCRIPTION_MS = 15 * 60 * 1000;
const STALE_SWEEP_BATCH = 50;

// The webhook is the only thing that finishes a transcription, so if it never
// arrives (secret mismatch, delivery outage, the fetch action crashing) a memo
// would say "Transcribing…" forever with no retry. Every 15 minutes, anything
// pending longer than STALE_TRANSCRIPTION_MS is resolved one way or another:
// - with a job id: check that job once (transcribeEntry never resubmits one),
//   which lands it on done, failed or timed_out;
// - without one: the submit never recorded a job, so it becomes timed_out,
//   and Retry submits it fresh.
// A memo that's merely mid-transcription is younger than the cutoff and is
// left alone.
export const sweepStaleTranscriptions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_TRANSCRIPTION_MS;
    const candidates = await ctx.db
      .query("entries")
      .withIndex("by_transcriptionStatus_requestedAt", (q) =>
        q.eq("transcriptionStatus", "pending").lt("transcriptionRequestedAt", cutoff),
      )
      .take(STALE_SWEEP_BATCH);

    for (const entry of candidates) {
      // Rows from before transcriptionRequestedAt existed sort first in the
      // index (undefined < any number), so check their insert time instead.
      if ((entry.transcriptionRequestedAt ?? entry._creationTime) >= cutoff) continue;
      if (entry.transcriptionJobId === undefined) {
        await ctx.db.patch(entry._id, { transcriptionStatus: "timed_out" });
      } else {
        // Restarts the clock, so a slow check isn't queued again next sweep.
        await ctx.db.patch(entry._id, { transcriptionRequestedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.transcription.transcribeEntry, { entryId: entry._id });
      }
    }
  },
});

export const setTranscript = internalMutation({
  args: { entryId: v.id("entries"), transcript: v.string() },
  handler: async (ctx, { entryId, transcript }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) return;
    // Second line of defence after getEntryAwaitingTranscript: a retry's
    // action can also land here. A hand-edited transcript is never replaced.
    if (entry.originalTranscript !== undefined) {
      await ctx.db.patch(entryId, { transcriptionStatus: "done" });
      return;
    }
    await ctx.db.patch(entryId, { transcript, transcriptionStatus: "done" });
  },
});

export const setTranscriptionFailed = internalMutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    await ctx.db.patch(entryId, { transcriptionStatus: "failed" });
  },
});

export const listInbox = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await requireUserId(ctx);
    return await listInboxHandler(ctx, userId, paginationOpts);
  },
});

export const listKept = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await requireUserId(ctx);
    return await listByStatusHandler(ctx, userId, "kept", paginationOpts);
  },
});

// Backs the Archive screen's status filter. Promoted and discarded entries had
// no browse surface at all before this — they were reachable only by guessing
// a search term.
export const listByStatus = query({
  args: {
    status: v.union(v.literal("kept"), v.literal("promoted"), v.literal("discarded")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { status, paginationOpts }) => {
    const userId = await requireUserId(ctx);
    return await listByStatusHandler(ctx, userId, status, paginationOpts);
  },
});

// Backs the reminder deep-link: the notification names one entry, which may
// be well past the first page of the archive, so it's fetched directly rather
// than hoped for in a list.
export const getEntry = query({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUserId(ctx);
    const entry = await requireOwnedEntry(ctx, userId, entryId);
    return {
      ...entry,
      audioUrl: entry.audioStorageId ? await ctx.storage.getUrl(entry.audioStorageId) : null,
    };
  },
});

// Largest page the export may ask for. Transcript-only rows are small, but
// the cap keeps one call well under Convex's per-function read limit however
// the client is configured.
const EXPORT_PAGE_MAX = 500;

// One page of everything the user has captured, newest first, for Settings →
// Download all captures. The client walks the pages; no single call reads the
// whole history. Audio is left out — its URLs expire, so they'd be dead links
// in a backup.
export const exportEntriesPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await requireUserId(ctx);
    const result = await ctx.db
      .query("entries")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, EXPORT_PAGE_MAX) });
    return {
      ...result,
      page: result.page.map((entry) => ({
        createdAt: entry.createdAt,
        captureMode: entry.captureMode,
        status: entry.status,
        promotedTo: entry.promotedTo,
        transcript: entry.transcript,
        transcriptionStatus: entry.transcriptionStatus,
        originalTranscript: entry.originalTranscript,
      })),
    };
  },
});

// getStatsHandler existed for lc_get_stats only; the app had no way to see the
// same breakdown. Informational, per the README — no streaks, no gamification.
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await getStatsHandler(ctx, userId);
  },
});

export const getUntriagedCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const entries = await ctx.db
      .query("entries")
      .withIndex("by_user_status_createdAt", (q) => q.eq("userId", userId).eq("status", "untriaged"))
      .take(COUNT_CAP + 1);
    // `capped` lets the UI render "500+" rather than silently reporting a
    // wrong number. Still a plain count with no pressure framing (see README's
    // design constraints) — just an honest one.
    return { count: Math.min(entries.length, COUNT_CAP), capped: entries.length > COUNT_CAP };
  },
});

export const keepEntry = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUserId(ctx);
    await keepHandler(ctx, userId, entryId);
  },
});

export const discardEntry = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUserId(ctx);
    await discardHandler(ctx, userId, entryId);
  },
});

export const undoDiscard = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUserId(ctx);
    return await undoDiscardHandler(ctx, userId, entryId);
  },
});

export const returnToInbox = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUserId(ctx);
    await returnToInboxHandler(ctx, userId, entryId);
  },
});

export const markPromoted = mutation({
  args: {
    entryId: v.id("entries"),
    destination: promotedToValidator,
  },
  handler: async (ctx, { entryId, destination }) => {
    const userId = await requireUserId(ctx);
    await markPromotedHandler(ctx, userId, entryId, destination);
  },
});

export const updateTranscript = mutation({
  args: { entryId: v.id("entries"), transcript: v.string() },
  handler: async (ctx, { entryId, transcript }) => {
    const userId = await requireUserId(ctx);
    await updateTranscriptHandler(ctx, userId, entryId, transcript);
  },
});

export const revertTranscript = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUserId(ctx);
    await revertTranscriptHandler(ctx, userId, entryId);
  },
});

export const retryTranscription = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUserId(ctx);
    await retryTranscriptionHandler(ctx, userId, entryId);
  },
});

export const searchEntries = query({
  args: {
    query: v.string(),
    status: v.optional(
      v.union(v.literal("untriaged"), v.literal("kept"), v.literal("discarded"), v.literal("promoted")),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query: searchQuery, status, limit }) => {
    const userId = await requireUserId(ctx);
    return await searchHandler(ctx, userId, searchQuery, status, limit ?? 20);
  },
});

// ── MCP-facing functions (shared-secret auth, explicit userId) ───────────────

export const mcpListInbox = query({
  args: { secret: v.string(), userId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { secret, userId, paginationOpts }) => {
    requireMcpSecret(secret);
    return await listInboxHandler(ctx, userId, paginationOpts);
  },
});

// Mirrors the Archive screen's tabs. Was hardcoded to "kept", which left
// promoted and discarded entries reachable over MCP only by guessing a search
// term — while the UI could browse them.
export const mcpListByStatus = query({
  args: {
    secret: v.string(),
    userId: v.string(),
    status: v.union(v.literal("kept"), v.literal("promoted"), v.literal("discarded")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { secret, userId, status, paginationOpts }) => {
    requireMcpSecret(secret);
    return await listByStatusHandler(ctx, userId, status, paginationOpts);
  },
});

export const mcpGetEntry = query({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries") },
  handler: async (ctx, { secret, userId, entryId }) => {
    requireMcpSecret(secret);
    const entry = await requireOwnedEntry(ctx, userId, entryId);
    const audioUrl = entry.audioStorageId ? await ctx.storage.getUrl(entry.audioStorageId) : null;
    return { ...entry, audioUrl };
  },
});

export const mcpSearch = query({
  args: {
    secret: v.string(),
    userId: v.string(),
    query: v.string(),
    status: v.optional(
      v.union(v.literal("untriaged"), v.literal("kept"), v.literal("discarded"), v.literal("promoted")),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { secret, userId, query: searchQuery, status, limit }) => {
    requireMcpSecret(secret);
    return await searchHandler(ctx, userId, searchQuery, status, limit ?? 20);
  },
});

export const mcpKeep = mutation({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries") },
  handler: async (ctx, { secret, userId, entryId }) => {
    requireMcpSecret(secret);
    await keepHandler(ctx, userId, entryId);
  },
});

export const mcpDiscard = mutation({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries") },
  handler: async (ctx, { secret, userId, entryId }) => {
    requireMcpSecret(secret);
    await discardHandler(ctx, userId, entryId);
  },
});

export const mcpUndoDiscard = mutation({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries") },
  handler: async (ctx, { secret, userId, entryId }) => {
    requireMcpSecret(secret);
    // Returns where the entry actually landed — undo restores to whatever it
    // was discarded from, which isn't always "untriaged".
    return await undoDiscardHandler(ctx, userId, entryId);
  },
});

export const mcpReturnToInbox = mutation({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries") },
  handler: async (ctx, { secret, userId, entryId }) => {
    requireMcpSecret(secret);
    await returnToInboxHandler(ctx, userId, entryId);
  },
});

export const mcpMarkPromoted = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    entryId: v.id("entries"),
    destination: promotedToValidator,
  },
  handler: async (ctx, { secret, userId, entryId, destination }) => {
    requireMcpSecret(secret);
    await markPromotedHandler(ctx, userId, entryId, destination);
  },
});

export const mcpUpdateTranscript = mutation({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries"), transcript: v.string() },
  handler: async (ctx, { secret, userId, entryId, transcript }) => {
    requireMcpSecret(secret);
    await updateTranscriptHandler(ctx, userId, entryId, transcript);
  },
});

export const mcpRevertTranscript = mutation({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries") },
  handler: async (ctx, { secret, userId, entryId }) => {
    requireMcpSecret(secret);
    await revertTranscriptHandler(ctx, userId, entryId);
  },
});

export const mcpRetryTranscription = mutation({
  args: { secret: v.string(), userId: v.string(), entryId: v.id("entries") },
  handler: async (ctx, { secret, userId, entryId }) => {
    requireMcpSecret(secret);
    await retryTranscriptionHandler(ctx, userId, entryId);
  },
});

export const mcpGetStats = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, { secret, userId }) => {
    requireMcpSecret(secret);
    return await getStatsHandler(ctx, userId);
  },
});

export const mcpCaptureText = mutation({
  args: { secret: v.string(), userId: v.string(), transcript: v.string() },
  handler: async (ctx, { secret, userId, transcript }) => {
    requireMcpSecret(secret);
    return await createTextEntryHandler(ctx, userId, {
      transcript,
      capturedAt: Date.now(),
      captureMode: "chat",
    });
  },
});
