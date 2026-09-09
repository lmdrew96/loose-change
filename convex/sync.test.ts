import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

// A sync retry after a lost response replays the exact same mutation with the
// same localId. These cover that replay for both capture paths.
describe("sync is idempotent on localId", () => {
  test("replaying a text capture resolves to the same entry", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "user_owner" });
    const args = {
      transcript: "one thought",
      capturedAt: Date.now(),
      captureMode: "text" as const,
      localId: "local-1",
    };

    const first = await owner.mutation(api.entries.createTextEntry, args);
    const second = await owner.mutation(api.entries.createTextEntry, args);

    expect(second).toBe(first);
    const all = await t.run((ctx) => ctx.db.query("entries").collect());
    expect(all).toHaveLength(1);
  });

  test("replaying a voice capture reuses the entry and drops the re-uploaded blob", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "user_owner" });
    const capturedAt = Date.now();

    const firstBlob = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "audio/webm" })));
    const first = await owner.mutation(api.entries.createVoiceEntry, {
      audioStorageId: firstBlob,
      capturedAt,
      localId: "local-2",
    });

    // The retry uploads a fresh copy of the same audio before re-calling.
    const retryBlob = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "audio/webm" })));
    const second = await owner.mutation(api.entries.createVoiceEntry, {
      audioStorageId: retryBlob,
      capturedAt,
      localId: "local-2",
    });

    expect(second).toBe(first);
    const all = await t.run((ctx) => ctx.db.query("entries").collect());
    expect(all).toHaveLength(1);
    expect(all[0].audioStorageId).toBe(firstBlob);
    // The orphan was cleaned up rather than left dangling in storage.
    expect(await t.run((ctx) => ctx.storage.getUrl(retryBlob))).toBeNull();
  });

  test("two different users can use the same localId without colliding", async () => {
    const t = convexTest(schema, modules);
    const args = { transcript: "same id", capturedAt: Date.now(), captureMode: "text" as const, localId: "shared" };

    const a = await t.withIdentity({ subject: "user_a" }).mutation(api.entries.createTextEntry, args);
    const b = await t.withIdentity({ subject: "user_b" }).mutation(api.entries.createTextEntry, args);

    expect(a).not.toBe(b);
    expect(await t.run((ctx) => ctx.db.query("entries").collect())).toHaveLength(2);
  });

  test("captures without a localId are never deduped against each other", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "user_owner" });
    const args = { transcript: "no id", capturedAt: Date.now(), captureMode: "text" as const };

    await owner.mutation(api.entries.createTextEntry, args);
    await owner.mutation(api.entries.createTextEntry, args);

    expect(await t.run((ctx) => ctx.db.query("entries").collect())).toHaveLength(2);
  });
});
