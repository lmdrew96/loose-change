"use node";

import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { isReminderDue, resolveSchedule } from "./reminderSchedule";

// Runs hourly. Sends to each device whose own schedule, in its own timezone,
// says now — one push carrying a random already-kept entry as a gentle
// "remember this?". Never a nudge about the untriaged backlog (README rules
// that kind of nag out).
export const sendReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      console.error("VAPID keys not configured; skipping reminder push");
      return;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const subscriptions = await ctx.runQuery(internal.pushData.listSubscriptions, {});

    const now = Date.now();

    for (const sub of subscriptions) {
      let due: boolean;
      try {
        due = isReminderDue(resolveSchedule(sub), sub.lastSentAt, now);
      } catch (err) {
        // A timezone this runtime doesn't recognise. Skip rather than stop
        // everyone else's reminders.
        console.error("Bad reminder schedule for subscription", sub._id, err);
        continue;
      }
      if (!due) continue;

      const entry = await ctx.runQuery(internal.pushData.getRandomKeptEntry, { userId: sub.userId });
      if (!entry) continue;

      const claimed = await ctx.runMutation(internal.pushData.claimReminder, {
        id: sub._id,
        expectedLastSentAt: sub.lastSentAt,
        sentAt: now,
      });
      if (!claimed) continue;

      const payload = JSON.stringify({
        title: "Loose Change",
        body: entry.transcript ?? "You kept an idea — take another look?",
        entryId: entry.entryId,
      });

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await ctx.runMutation(internal.pushData.deleteSubscriptionById, { id: sub._id });
        } else {
          console.error("Push send failed for subscription", sub._id, err);
          await ctx.runMutation(internal.pushData.releaseReminder, {
            id: sub._id,
            claimedAt: now,
            previousLastSentAt: sub.lastSentAt,
          });
        }
      }
    }
  },
});
