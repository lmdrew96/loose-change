import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Creates a voice entry with a real stored blob so retention has something to
// delete, then rewrites createdAt/triagedAt to simulate an aged row.
async function seedVoiceEntry(
  t: ReturnType<typeof convexTest>,
  userId: string,
  fields: { createdAt: number; triagedAt?: number; status: "untriaged" | "kept" | "discarded" | "promoted" },
) {
  return await t.run(async (ctx) => {
    const audioStorageId = await ctx.storage.store(new Blob(["audio"], { type: "audio/webm" }));
    return await ctx.db.insert("entries", {
      userId,
      captureMode: "voice",
      transcript: "aged memo",
      audioStorageId,
      transcriptionStatus: "done",
      status: fields.status,
      promotedTo: null,
      discardedAt: null,
      audioDeletedAt: null,
      triagedAt: fields.triagedAt,
      createdAt: fields.createdAt,
    });
  });
}

describe("audio retention measures from triage, not capture", () => {
  test("an old memo triaged today keeps its audio", async () => {
    const t = convexTest(schema, modules);
    const entryId = await seedVoiceEntry(t, "user_owner", {
      createdAt: Date.now() - 90 * DAY_MS,
      triagedAt: Date.now(),
      status: "kept",
    });

    await t.mutation(internal.retention.deleteExpiredAudio, {});

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.audioStorageId).not.toBeNull();
    expect(entry?.audioDeletedAt).toBeNull();
  });

  test("a memo triaged over 30 days ago loses its audio but keeps its transcript", async () => {
    const t = convexTest(schema, modules);
    const triagedAt = Date.now() - THIRTY_DAYS_MS - DAY_MS;
    const entryId = await seedVoiceEntry(t, "user_owner", {
      createdAt: triagedAt,
      triagedAt,
      status: "kept",
    });

    await t.mutation(internal.retention.deleteExpiredAudio, {});

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.audioStorageId).toBeNull();
    expect(entry?.audioDeletedAt).not.toBeNull();
    expect(entry?.transcript).toBe("aged memo");
  });

  test("an untriaged memo keeps its audio no matter how old", async () => {
    const t = convexTest(schema, modules);
    const entryId = await seedVoiceEntry(t, "user_owner", {
      createdAt: Date.now() - 400 * DAY_MS,
      status: "untriaged",
    });

    await t.mutation(internal.retention.deleteExpiredAudio, {});

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.audioStorageId).not.toBeNull();
  });

  test("a row triaged before triagedAt existed falls back to createdAt", async () => {
    const t = convexTest(schema, modules);
    const entryId = await seedVoiceEntry(t, "user_owner", {
      createdAt: Date.now() - 90 * DAY_MS,
      status: "kept",
    });

    await t.mutation(internal.retention.deleteExpiredAudio, {});

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.audioStorageId).toBeNull();
  });

  test("an already-cleaned row is skipped without error", async () => {
    const t = convexTest(schema, modules);
    const entryId = await t.run((ctx) =>
      ctx.db.insert("entries", {
        userId: "user_owner",
        captureMode: "voice",
        transcript: "already cleaned",
        audioStorageId: null,
        transcriptionStatus: "done",
        status: "kept",
        promotedTo: null,
        discardedAt: null,
        audioDeletedAt: Date.now() - DAY_MS,
        triagedAt: Date.now() - 90 * DAY_MS,
        createdAt: Date.now() - 90 * DAY_MS,
      }),
    );

    await expect(t.mutation(internal.retention.deleteExpiredAudio, {})).resolves.not.toThrow();
    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.audioStorageId).toBeNull();
  });
});

describe("undoDiscard and the retention clock", () => {
  test("restoring to untriaged clears triagedAt", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "user_owner" });
    const entryId = await owner.mutation(api.entries.createTextEntry, {
      transcript: "a thought",
      capturedAt: Date.now(),
      captureMode: "text",
    });

    await owner.mutation(api.entries.discardEntry, { entryId });
    expect((await t.run((ctx) => ctx.db.get(entryId)))?.triagedAt).toBeDefined();

    await owner.mutation(api.entries.undoDiscard, { entryId });
    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.status).toBe("untriaged");
    expect(entry?.triagedAt).toBeUndefined();
  });

  test("restoring to kept restarts the clock rather than clearing it", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "user_owner" });
    const entryId = await owner.mutation(api.entries.createTextEntry, {
      transcript: "a kept thought",
      capturedAt: Date.now(),
      captureMode: "text",
    });

    await owner.mutation(api.entries.keepEntry, { entryId });
    await owner.mutation(api.entries.discardEntry, { entryId });
    await owner.mutation(api.entries.undoDiscard, { entryId });

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.status).toBe("kept");
    expect(entry?.triagedAt).toBeDefined();
  });
});

describe("expired discards are purged", () => {
  test("a discard older than 30 days is deleted outright, blob and all", async () => {
    const t = convexTest(schema, modules);
    const discardedAt = Date.now() - THIRTY_DAYS_MS - DAY_MS;
    const entryId = await t.run(async (ctx) => {
      const audioStorageId = await ctx.storage.store(new Blob(["audio"], { type: "audio/webm" }));
      return await ctx.db.insert("entries", {
        userId: "user_owner",
        captureMode: "voice",
        transcript: "long gone",
        audioStorageId,
        transcriptionStatus: "done",
        status: "discarded",
        promotedTo: null,
        discardedAt,
        discardedFromStatus: "untriaged",
        audioDeletedAt: null,
        triagedAt: discardedAt,
        createdAt: discardedAt,
      });
    });

    await t.mutation(internal.retention.purgeExpiredDiscards, {});

    expect(await t.run((ctx) => ctx.db.get(entryId))).toBeNull();
  });

  test("a discard inside its undo window survives", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "user_owner" });
    const entryId = await owner.mutation(api.entries.createTextEntry, {
      transcript: "still recoverable",
      capturedAt: Date.now() - 90 * DAY_MS,
      captureMode: "text",
    });
    await owner.mutation(api.entries.discardEntry, { entryId });

    await t.mutation(internal.retention.purgeExpiredDiscards, {});

    // Captured 90 days ago but discarded just now — the window runs from the
    // discard, so this must survive and stay undoable.
    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.status).toBe("discarded");
    await expect(owner.mutation(api.entries.undoDiscard, { entryId })).resolves.not.toThrow();
  });

  test("kept and promoted entries are never purged", async () => {
    const t = convexTest(schema, modules);
    const old = Date.now() - 400 * DAY_MS;
    const keptId = await t.run((ctx) =>
      ctx.db.insert("entries", {
        userId: "user_owner",
        captureMode: "text",
        transcript: "kept forever",
        audioStorageId: null,
        transcriptionStatus: "n/a",
        status: "kept",
        promotedTo: null,
        discardedAt: null,
        audioDeletedAt: null,
        triagedAt: old,
        createdAt: old,
      }),
    );

    await t.mutation(internal.retention.purgeExpiredDiscards, {});

    expect(await t.run((ctx) => ctx.db.get(keptId))).not.toBeNull();
  });
});
