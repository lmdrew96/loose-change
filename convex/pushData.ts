import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./authHelpers";
import { DEFAULT_HOUR, looksLikeTimeZone } from "./reminderSchedule";

const frequencyValidator = v.union(v.literal("weekly"), v.literal("every3days"));

function validateSchedule(dayOfWeek: number, hour: number, timeZone: string): void {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new Error("Invalid day of week");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("Invalid hour");
  if (!looksLikeTimeZone(timeZone)) throw new Error("Invalid time zone");
}

export const getVapidPublicKey = query({
  args: {},
  handler: async () => {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  },
});

export const subscribe = mutation({
  // timeZone is the device's, so a brand-new subscription starts on Sunday
  // morning local time rather than the legacy UTC slot.
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string(), timeZone: v.optional(v.string()) },
  handler: async (ctx, { endpoint, p256dh, auth, timeZone }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) {
      // A re-subscribe keeps whatever schedule the device already had.
      await ctx.db.patch(existing._id, { userId, p256dh, auth });
      return;
    }
    const schedule =
      timeZone && looksLikeTimeZone(timeZone)
        ? { frequency: "weekly" as const, dayOfWeek: 0, hour: DEFAULT_HOUR, timeZone }
        : {};
    await ctx.db.insert("pushSubscriptions", { userId, endpoint, p256dh, auth, createdAt: Date.now(), ...schedule });
  },
});

// Settings reads the schedule for this device's own subscription only.
export const getMySchedule = query({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const userId = await requireUserId(ctx);
    const sub = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (!sub || sub.userId !== userId) return null;
    return {
      frequency: sub.frequency,
      dayOfWeek: sub.dayOfWeek,
      hour: sub.hour,
      timeZone: sub.timeZone,
      lastSentAt: sub.lastSentAt,
    };
  },
});

export const updateSchedule = mutation({
  args: {
    endpoint: v.string(),
    frequency: frequencyValidator,
    dayOfWeek: v.number(),
    hour: v.number(),
    timeZone: v.string(),
  },
  handler: async (ctx, { endpoint, frequency, dayOfWeek, hour, timeZone }) => {
    const userId = await requireUserId(ctx);
    validateSchedule(dayOfWeek, hour, timeZone);
    const sub = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (!sub || sub.userId !== userId) throw new Error("Reminders aren't turned on for this device");
    await ctx.db.patch(sub._id, { frequency, dayOfWeek, hour, timeZone });
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

// Compare-and-set on lastSentAt: only the run that still sees the value it
// checked gets to send. Two overlapping runs can't both claim one window.
export const claimReminder = internalMutation({
  args: { id: v.id("pushSubscriptions"), expectedLastSentAt: v.optional(v.number()), sentAt: v.number() },
  handler: async (ctx, { id, expectedLastSentAt, sentAt }) => {
    const sub = await ctx.db.get(id);
    if (!sub || sub.lastSentAt !== expectedLastSentAt) return false;
    await ctx.db.patch(id, { lastSentAt: sentAt });
    return true;
  },
});

// Undoes a claim whose push then failed, so the next hourly run in the
// window can try again — unless something else has claimed it since.
export const releaseReminder = internalMutation({
  args: { id: v.id("pushSubscriptions"), claimedAt: v.number(), previousLastSentAt: v.optional(v.number()) },
  handler: async (ctx, { id, claimedAt, previousLastSentAt }) => {
    const sub = await ctx.db.get(id);
    if (!sub || sub.lastSentAt !== claimedAt) return;
    await ctx.db.patch(id, { lastSentAt: previousLastSentAt });
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
    // The id travels with the push so tapping it can open this exact entry
    // rather than dumping the user in the archive to go find it.
    return { entryId: pick._id, transcript: pick.transcript };
  },
});
