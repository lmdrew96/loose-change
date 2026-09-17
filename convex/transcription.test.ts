import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

async function insertVoiceEntry(
  t: ReturnType<typeof convexTest>,
  transcriptionStatus: Doc<"entries">["transcriptionStatus"],
  { withAudio = true } = {},
) {
  return await t.run(async (ctx) => {
    const audioStorageId = withAudio
      ? await ctx.storage.store(new Blob(["a"], { type: "audio/webm" }))
      : null;
    return await ctx.db.insert("entries", {
      userId: "user_owner",
      captureMode: "voice",
      transcript: null,
      audioStorageId,
      transcriptionStatus,
      transcriptionJobId: "job-1",
      status: "untriaged",
      promotedTo: null,
      discardedAt: null,
      audioDeletedAt: null,
      createdAt: Date.now(),
    });
  });
}

describe("retryTranscription", () => {
  test("a timed-out entry goes back to pending and reschedules transcription", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "timed_out");

    await t.withIdentity({ subject: "user_owner" }).mutation(api.entries.retryTranscription, { entryId });

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcriptionStatus).toBe("pending");
    // The job id survives, so the rescheduled action re-polls instead of resubmitting.
    expect(entry?.transcriptionJobId).toBe("job-1");
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
  });

  test.each(["failed", "done", "pending", "n/a"] as const)("a %s entry can't be retried", async (status) => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, status);

    await expect(
      t.withIdentity({ subject: "user_owner" }).mutation(api.entries.retryTranscription, { entryId }),
    ).rejects.toThrow("Only a transcription that timed out can be retried");
  });

  test("an entry whose audio was already cleared can't be retried", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "timed_out", { withAudio: false });

    await expect(
      t.withIdentity({ subject: "user_owner" }).mutation(api.entries.retryTranscription, { entryId }),
    ).rejects.toThrow("Audio is no longer available");
  });

  test("another user can't retry someone else's entry", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "timed_out");

    await expect(
      t.withIdentity({ subject: "user_intruder" }).mutation(api.entries.retryTranscription, { entryId }),
    ).rejects.toThrow("Entry not found");
  });
});

describe("sweepStaleTranscriptions", () => {
  const MINUTE = 60 * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  async function insertPending(
    t: ReturnType<typeof convexTest>,
    { requestedAgoMs, jobId }: { requestedAgoMs?: number; jobId?: string },
  ) {
    return await t.run(async (ctx) => {
      const audioStorageId = await ctx.storage.store(new Blob(["a"], { type: "audio/webm" }));
      return await ctx.db.insert("entries", {
        userId: "user_owner",
        captureMode: "voice",
        transcript: null,
        audioStorageId,
        transcriptionStatus: "pending",
        transcriptionJobId: jobId,
        transcriptionRequestedAt: requestedAgoMs === undefined ? undefined : Date.now() - requestedAgoMs,
        status: "untriaged",
        promotedTo: null,
        discardedAt: null,
        audioDeletedAt: null,
        createdAt: Date.now(),
      });
    });
  }

  const scheduledCount = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);

  test("a memo still inside the window is left alone", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertPending(t, { requestedAgoMs: 5 * MINUTE, jobId: "job-1" });

    await t.mutation(internal.entries.sweepStaleTranscriptions, {});

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcriptionStatus).toBe("pending");
    expect(await scheduledCount(t)).toBe(0);
  });

  test("a stale memo with a job gets that job checked once, not resubmitted", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertPending(t, { requestedAgoMs: 20 * MINUTE, jobId: "job-1" });

    await t.mutation(internal.entries.sweepStaleTranscriptions, {});

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    // The job id is kept, so transcribeEntry checks it instead of submitting.
    expect(entry?.transcriptionJobId).toBe("job-1");
    expect(await scheduledCount(t)).toBe(1);

    // And the clock restarted, so the next sweep doesn't queue it again.
    await t.mutation(internal.entries.sweepStaleTranscriptions, {});
    expect(await scheduledCount(t)).toBe(1);
  });

  test("a stale memo with no job becomes retryable", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertPending(t, { requestedAgoMs: 20 * MINUTE });

    await t.mutation(internal.entries.sweepStaleTranscriptions, {});

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcriptionStatus).toBe("timed_out");
    expect(await scheduledCount(t)).toBe(0);
  });

  test("an older row without a request time is judged by when it was inserted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() - 60 * MINUTE);
    const t = convexTest(schema, modules);
    const oldId = await insertPending(t, {});
    vi.setSystemTime(Date.now() + 60 * MINUTE);
    const freshId = await insertPending(t, {});

    await t.mutation(internal.entries.sweepStaleTranscriptions, {});

    const [old, fresh] = await t.run(async (ctx) => [await ctx.db.get(oldId), await ctx.db.get(freshId)]);
    expect(old?.transcriptionStatus).toBe("timed_out");
    expect(fresh?.transcriptionStatus).toBe("pending");
  });

  test("a finished transcript isn't flipped back to retryable by a late check", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "done");

    await t.mutation(internal.entries.setTranscriptionTimedOut, { entryId });

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcriptionStatus).toBe("done");
  });

  test("new voice memos and retries record when transcription was requested", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "timed_out");
    await t.withIdentity({ subject: "user_owner" }).mutation(api.entries.retryTranscription, { entryId });
    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcriptionRequestedAt).toBeTypeOf("number");
  });
});
