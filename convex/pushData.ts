import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./authHelpers";

export const getVapidPublicKey = query({
  args: {},
  handler: async () => {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  },
});

export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, { endpoint, p256dh, auth }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { userId, p256dh, auth });
    } else {
      await ctx.db.insert("pushSubscriptions", { userId, endpoint, p256dh, auth, createdAt: Date.now() });
    }
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const listSubscriptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("pushSubscriptions").collect();
  },
});

export const deleteSubscriptionById = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// Pool the reminder draws from. Deliberately the most recent N kept entries
// rather than the whole archive: it bounds the scan, and a nudge to revisit
// something from the last few hundred keeps is more useful than one pulled
// uniformly from years of history.
const REMINDER_POOL = 200;

export const getRandomKeptEntry = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const kept = await ctx.db
      .query("entries")
      .withIndex("by_user_status_createdAt", (q) => q.eq("userId", userId).eq("status", "kept"))
      .order("desc")
      .take(REMINDER_POOL);
    if (kept.length === 0) return null;
    const pick = kept[Math.floor(Math.random() * kept.length)];
    return { transcript: pick.transcript };
  },
});
