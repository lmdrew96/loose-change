import { internalMutation } from "./_generated/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TRIAGED_STATUSES = ["kept", "discarded", "promoted"] as const;

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
