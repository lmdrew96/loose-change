import { mutation, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

async function requireUserId(ctx: MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

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
  handler: async (ctx, { transcript, capturedAt, captureMode }) => {
    const userId = await requireUserId(ctx);
    return await ctx.db.insert("entries", {
      userId,
      captureMode,
      transcript,
      audioStorageId: null,
      transcriptionStatus: "n/a",
      status: "untriaged",
      promotedTo: null,
      discardedAt: null,
      audioDeletedAt: null,
      createdAt: capturedAt,
    });
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
