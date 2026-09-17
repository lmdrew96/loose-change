import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  entries: defineTable({
    userId: v.string(),
    captureMode: v.union(v.literal("voice"), v.literal("text"), v.literal("chat")),
    transcript: v.union(v.string(), v.null()),
    // The transcript as it was before the user first edited it — set on the
    // first edit only, so any number of later edits can still be reverted to
    // what was actually captured. Absent means never edited. Search keeps
    // indexing `transcript`, the corrected text.
    originalTranscript: v.optional(v.string()),
    audioStorageId: v.union(v.id("_storage"), v.null()),
    transcriptionStatus: v.union(
      v.literal("n/a"),
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed"),
      // Gave up polling while AssemblyAI was still working. Distinct from
      // "failed" because it's retryable — the audio is fine, their queue was
      // just slow — and the UI offers a retry for this state only.
      v.literal("timed_out"),
    ),
    // AssemblyAI's id for the submitted job. Kept so a retry after a timeout
    // re-polls the job already in their queue instead of resubmitting to the
    // back of it (and paying for it twice). Absent on entries transcribed
    // before this existed and on text/chat entries.
    transcriptionJobId: v.optional(v.string()),
    status: v.union(
      v.literal("untriaged"),
      v.literal("kept"),
      v.literal("discarded"),
      v.literal("promoted"),
    ),
    // Where a promoted entry was sent. Widening this to a plain string later
    // is a pure superset — every existing value is already a lowercase string
    // — so no backfill is needed if the ecosystem outgrows a closed union.
    promotedTo: v.union(
      v.literal("kindling"),
      v.literal("controlledchaos"),
      v.literal("threadnotes"),
      v.literal("tangle"),
      v.literal("chaospatch"),
      v.null(),
    ),
    discardedAt: v.union(v.number(), v.null()),
    // What status to restore on undoDiscard — discard is now reachable from
    // kept (not just untriaged via Triage), so a hardcoded "back to
    // untriaged" would wrongly dump a kept memo back into the inbox.
    // Absent on rows discarded before this field existed; those only ever
    // came from Triage, so undo falls back to "untriaged" for them.
    discardedFromStatus: v.optional(
      v.union(v.literal("untriaged"), v.literal("kept"), v.literal("promoted")),
    ),
    audioDeletedAt: v.union(v.number(), v.null()),
    // When the entry left the untriaged pool (kept / discarded / promoted).
    // Audio retention measures from here, not createdAt — the README's window
    // is "30 days after triage", so an old memo triaged today keeps its audio
    // for another 30 days rather than losing it at the next cron run.
    // Absent on rows triaged before this field existed; retention falls back
    // to createdAt for those, which is the pre-existing behaviour.
    triagedAt: v.optional(v.number()),
    // Client-generated id for a queued capture, carried through so a sync
    // retry is idempotent. Without it, a mutation that commits but whose
    // response is lost (mobile handoff, tab killed) re-syncs into a duplicate
    // entry. Absent on entries created before this existed and on MCP
    // captures, which have no offline queue.
    localId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user_status_createdAt", ["userId", "status", "createdAt"])
    .index("by_user_createdAt", ["userId", "createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_user_localId", ["userId", "localId"])
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

  pushSubscriptions: defineTable({
    userId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_endpoint", ["endpoint"]),
});
