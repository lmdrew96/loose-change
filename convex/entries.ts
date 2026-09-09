import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId, requireMcpSecret } from "./authHelpers";

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

async function createTextEntryHandler(
  ctx: MutationCtx,
  userId: string,
  args: { transcript: string; capturedAt: number; captureMode: "text" | "chat" },
) {
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

async function getStatsHandler(ctx: QueryCtx, userId: string) {
  const all = await ctx.db
    .query("entries")
    .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
    .collect();

  const stats = { untriaged: 0, kept: 0, discarded: 0, promoted: 0 };
  for (const entry of all) stats[entry.status]++;
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

async function markPromotedHandler(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"entries">,
  destination: "kindling" | "controlledchaos",
) {
  await requireOwnedEntry(ctx, userId, entryId);
  await ctx.db.patch(entryId, { status: "promoted", promotedTo: destination, triagedAt: Date.now() });
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
  return await search.take(limit);
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
  },
  handler: async (ctx, { audioStorageId, capturedAt }) => {
    const userId = await requireUserId(ctx);
    const entryId = await ctx.db.insert("entries", {
      userId,
      captureMode: "voice",
      transcript: null,
      audioStorageId,
      transcriptionStatus: "pending",
      status: "untriaged",
      promotedTo: null,
      discardedAt: null,
      audioDeletedAt: null,
      createdAt: capturedAt,
    });
    await ctx.scheduler.runAfter(0, internal.transcription.transcribeEntry, { entryId });
    return entryId;
  },
});

export const getAudioUrlForTranscription = internalQuery({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.audioStorageId === null) return null;
    return await ctx.storage.getUrl(entry.audioStorageId);
  },
});

export const setTranscript = internalMutation({
  args: { entryId: v.id("entries"), transcript: v.string() },
  handler: async (ctx, { entryId, transcript }) => {
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

export const getUntriagedCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const entries = await ctx.db
      .query("entries")
      .withIndex("by_user_status_createdAt", (q) => q.eq("userId", userId).eq("status", "untriaged"))
      .collect();
    return entries.length;
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
    await undoDiscardHandler(ctx, userId, entryId);
  },
});

export const markPromoted = mutation({
  args: {
    entryId: v.id("entries"),
    destination: v.union(v.literal("kindling"), v.literal("controlledchaos")),
  },
  handler: async (ctx, { entryId, destination }) => {
    const userId = await requireUserId(ctx);
    await markPromotedHandler(ctx, userId, entryId, destination);
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
    await undoDiscardHandler(ctx, userId, entryId);
  },
});

export const mcpMarkPromoted = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    entryId: v.id("entries"),
    destination: v.union(v.literal("kindling"), v.literal("controlledchaos")),
  },
  handler: async (ctx, { secret, userId, entryId, destination }) => {
    requireMcpSecret(secret);
    await markPromotedHandler(ctx, userId, entryId, destination);
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
