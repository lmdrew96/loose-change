"use node";

import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Sends one browser push per subscribed device, each carrying a random
// already-kept entry as a gentle "remember this?" resurfacing — not a nudge
// about untriaged backlog (README explicitly rules out that kind of nag).
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

    for (const sub of subscriptions) {
      const entry = await ctx.runQuery(internal.pushData.getRandomKeptEntry, { userId: sub.userId });
      if (!entry) continue;

      const payload = JSON.stringify({
        title: "Loose Change",
        body: entry.transcript ?? "You kept an idea — take another look?",
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
        }
      }
    }
  },
});
