import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

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
    return await ctx.db.insert("entries", {
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
  },
});
