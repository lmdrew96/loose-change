import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ENDPOINT = "https://push.example/abc";

const setup = () => convexTest(schema, modules);

async function subscribe(t: ReturnType<typeof setup>, userId: string, timeZone?: string) {
  await t.withIdentity({ subject: userId }).mutation(api.pushData.subscribe, {
    endpoint: ENDPOINT,
    p256dh: "p",
    auth: "a",
    timeZone,
  });
  return await t.run(async (ctx) =>
    ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", ENDPOINT))
      .unique(),
  );
}

describe("reminder schedules", () => {
  test("a new subscription starts on Sunday morning in the device's timezone", async () => {
    const t = setup();
    const sub = await subscribe(t, "user_owner", "America/New_York");
    expect(sub).toMatchObject({ frequency: "weekly", dayOfWeek: 0, hour: 10, timeZone: "America/New_York" });
  });

  test("re-subscribing keeps the schedule the device already had", async () => {
    const t = setup();
    const owner = t.withIdentity({ subject: "user_owner" });
    await subscribe(t, "user_owner", "America/New_York");
    await owner.mutation(api.pushData.updateSchedule, {
      endpoint: ENDPOINT,
      frequency: "every3days",
      dayOfWeek: 0,
      hour: 7,
      timeZone: "America/New_York",
    });
    const sub = await subscribe(t, "user_owner", "Europe/London");
    expect(sub).toMatchObject({ frequency: "every3days", hour: 7, timeZone: "America/New_York" });
  });

  test("only the owner can read or change a device's schedule", async () => {
    const t = setup();
    await subscribe(t, "user_owner", "UTC");
    const intruder = t.withIdentity({ subject: "user_intruder" });
    expect(await intruder.query(api.pushData.getMySchedule, { endpoint: ENDPOINT })).toBeNull();
    await expect(
      intruder.mutation(api.pushData.updateSchedule, {
        endpoint: ENDPOINT,
        frequency: "weekly",
        dayOfWeek: 1,
        hour: 9,
        timeZone: "UTC",
      }),
    ).rejects.toThrow("aren't turned on");
  });

  test.each([
    [{ dayOfWeek: 7, hour: 9, timeZone: "UTC" }, "day of week"],
    [{ dayOfWeek: 1, hour: 24, timeZone: "UTC" }, "hour"],
    [{ dayOfWeek: 1, hour: 9.5, timeZone: "UTC" }, "hour"],
    [{ dayOfWeek: 1, hour: 9, timeZone: "not a zone!" }, "time zone"],
  ])("rejects an out-of-range schedule %#", async (fields, message) => {
    const t = setup();
    await subscribe(t, "user_owner", "UTC");
    await expect(
      t
        .withIdentity({ subject: "user_owner" })
        .mutation(api.pushData.updateSchedule, { endpoint: ENDPOINT, frequency: "weekly", ...fields }),
    ).rejects.toThrow(message);
  });
});

describe("claimReminder", () => {
  test("only one of two overlapping runs gets to send", async () => {
    const t = setup();
    const sub = await subscribe(t, "user_owner", "UTC");
    const first = await t.mutation(internal.pushData.claimReminder, { id: sub!._id, sentAt: 1000 });
    const second = await t.mutation(internal.pushData.claimReminder, { id: sub!._id, sentAt: 1001 });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  test("a failed send is released so the next run can retry", async () => {
    const t = setup();
    const sub = await subscribe(t, "user_owner", "UTC");
    await t.mutation(internal.pushData.claimReminder, { id: sub!._id, sentAt: 1000 });
    await t.mutation(internal.pushData.releaseReminder, { id: sub!._id, claimedAt: 1000 });
    const after = await t.run((ctx) => ctx.db.get(sub!._id));
    expect(after?.lastSentAt).toBeUndefined();
  });

  test("a release doesn't undo a newer claim", async () => {
    const t = setup();
    const sub = await subscribe(t, "user_owner", "UTC");
    await t.mutation(internal.pushData.claimReminder, { id: sub!._id, sentAt: 1000 });
    await t.mutation(internal.pushData.claimReminder, { id: sub!._id, expectedLastSentAt: 1000, sentAt: 2000 });
    await t.mutation(internal.pushData.releaseReminder, { id: sub!._id, claimedAt: 1000 });
    const after = await t.run((ctx) => ctx.db.get(sub!._id));
    expect(after?.lastSentAt).toBe(2000);
  });
});
