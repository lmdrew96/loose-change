import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  entries: defineTable({
    userId: v.string(),
    captureMode: v.union(v.literal("voice"), v.literal("text"), v.literal("chat")),
    transcript: v.union(v.string(), v.null()),
    audioStorageId: v.union(v.id("_storage"), v.null()),
    transcriptionStatus: v.union(
      v.literal("n/a"),
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed"),
    ),
    status: v.union(
      v.literal("untriaged"),
      v.literal("kept"),
      v.literal("discarded"),
      v.literal("promoted"),
    ),
    promotedTo: v.union(v.literal("kindling"), v.literal("controlledchaos"), v.null()),
    discardedAt: v.union(v.number(), v.null()),
    audioDeletedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  })
    .index("by_user_status_createdAt", ["userId", "status", "createdAt"])
    .index("by_user_createdAt", ["userId", "createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .searchIndex("search_transcript", {
      searchField: "transcript",
      filterFields: ["userId", "status"],
    }),

  mcpTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_token", ["token"]),
});
