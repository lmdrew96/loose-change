import { internalMutation } from "./_generated/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TRIAGED_STATUSES = ["kept", "discarded", "promoted"] as const;

// Rows purged per run. The job is idempotent and runs daily, so a backlog
// larger than this simply drains over consecutive days rather than pushing a
// single mutation past Convex's read limit.
const PURGE_BATCH = 200;

export const deleteExpiredAudio = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    for (const status of TRIAGED_STATUSES) {
      // The window runs from triage, not capture — but triagedAt is always
      // >= createdAt, so `createdAt < cutoff` is a necessary condition for
      // `triagedAt < cutoff`. That lets the existing index stay a coarse
      // prefilter while the precise check happens below, which also keeps
      // rows triaged before triagedAt existed working (they fall back to
      // createdAt, i.e. exactly the old behaviour).
      const candidates = await ctx.db
        .query("entries")
        .withIndex("by_status_createdAt", (q) => q.eq("status", status).lt("createdAt", cutoff))
        .collect();

      for (const entry of candidates) {
        if (entry.audioStorageId === null) continue;
        if ((entry.triagedAt ?? entry.createdAt) >= cutoff) continue;
        await ctx.storage.delete(entry.audioStorageId);
        await ctx.db.patch(entry._id, { audioStorageId: null, audioDeletedAt: Date.now() });
      }
    }
  },
});

// Closes the 30-day undo window that discard advertises. Until this existed,
// "soft-delete with a 30-day undo window" had no closing edge — discarded
// memos kept their transcripts forever and kept surfacing in search, which is
// a weaker privacy posture than the README promises.
export const purgeExpiredDiscards = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    // Same coarse-prefilter reasoning as deleteExpiredAudio: discardedAt is
    // always >= createdAt, so this range can't miss an expired row, and the
    // precise check happens below.
    const candidates = await ctx.db
      .query("entries")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "discarded").lt("createdAt", cutoff))
      .take(PURGE_BATCH);

    for (const entry of candidates) {
      if ((entry.discardedAt ?? entry.createdAt) >= cutoff) continue;
      // Blob first — deleting the row first would orphan it in storage with
      // nothing left pointing at it.
      if (entry.audioStorageId !== null) await ctx.storage.delete(entry.audioStorageId);
      await ctx.db.delete(entry._id);
    }
  },
});
