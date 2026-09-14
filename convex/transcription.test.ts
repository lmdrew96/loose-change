import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
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
