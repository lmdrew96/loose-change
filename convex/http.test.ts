import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { WEBHOOK_AUTH_HEADER, WEBHOOK_PATH } from "./transcription";

const SECRET = "test-webhook-secret";

async function insertVoiceEntry(
  t: ReturnType<typeof convexTest>,
  transcriptionStatus: Doc<"entries">["transcriptionStatus"],
  transcriptionJobId?: string,
) {
  return await t.run(async (ctx) => {
    const audioStorageId = await ctx.storage.store(new Blob(["a"], { type: "audio/webm" }));
    return await ctx.db.insert("entries", {
      userId: "user_owner",
      captureMode: "voice",
      transcript: null,
      audioStorageId,
      transcriptionStatus,
      transcriptionJobId,
      status: "untriaged",
      promotedTo: null,
      discardedAt: null,
      audioDeletedAt: null,
      createdAt: Date.now(),
    });
  });
}

beforeEach(() => {
  vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("ASSEMBLYAI_API_KEY", "test-api-key");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AssemblyAI webhook", () => {
  const post = (t: ReturnType<typeof convexTest>, headers: Record<string, string>, body: unknown, entryId = "e1") =>
    t.fetch(`${WEBHOOK_PATH}?entryId=${entryId}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const scheduledCount = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);

  test.each([
    ["no auth header", {}],
    ["the wrong secret", { [WEBHOOK_AUTH_HEADER]: "nope" }],
  ])("rejects a call with %s and schedules nothing", async (_label, headers) => {
    const t = convexTest(schema, modules);
    const res = await post(t, headers, { transcript_id: "job-1", status: "completed" });
    expect(res.status).toBe(401);
    expect(await scheduledCount(t)).toBe(0);
  });

  test("rejects everything when no secret is configured", async () => {
    vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", "");
    const t = convexTest(schema, modules);
    const res = await post(t, { [WEBHOOK_AUTH_HEADER]: "" }, { transcript_id: "job-1", status: "completed" });
    expect(res.status).toBe(401);
  });

  test("rejects a body without a transcript id", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, { [WEBHOOK_AUTH_HEADER]: SECRET }, { status: "completed" });
    expect(res.status).toBe(400);
    expect(await scheduledCount(t)).toBe(0);
  });

  test("an authenticated call answers 200 and schedules the fetch", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, { [WEBHOOK_AUTH_HEADER]: SECRET }, { transcript_id: "job-1", status: "completed" });
    expect(res.status).toBe(200);
    expect(await scheduledCount(t)).toBe(1);
  });
});

describe("getEntryAwaitingTranscript", () => {
  test.each(["pending", "timed_out"] as const)("finds a %s entry waiting on this job", async (status) => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, status, "job-1");
    expect(await t.query(internal.entries.getEntryAwaitingTranscript, { entryId, jobId: "job-1" })).toBe(entryId);
  });

  test("finds an entry whose job id hasn't been saved yet", async () => {
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "pending");
    expect(await t.query(internal.entries.getEntryAwaitingTranscript, { entryId, jobId: "job-1" })).toBe(entryId);
  });

  test("ignores a different job, a resolved entry, and a malformed id", async () => {
    const t = convexTest(schema, modules);
    const otherJob = await insertVoiceEntry(t, "pending", "job-2");
    const done = await insertVoiceEntry(t, "done", "job-1");
    const q = (entryId: string) => t.query(internal.entries.getEntryAwaitingTranscript, { entryId, jobId: "job-1" });
    expect(await q(otherJob)).toBeNull();
    expect(await q(done)).toBeNull();
    expect(await q("not-an-id")).toBeNull();
  });
});

describe("transcription", () => {
  test("a new voice memo submits with an authenticated webhook and doesn't poll", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "job-new" }));
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "pending");

    await t.action(internal.transcription.transcribeEntry, { entryId });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.webhook_url).toBe(`https://example.convex.site${WEBHOOK_PATH}?entryId=${entryId}`);
    expect(body.webhook_auth_header_name).toBe(WEBHOOK_AUTH_HEADER);
    expect(body.webhook_auth_header_value).toBe(SECRET);
    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcriptionStatus).toBe("pending");
    expect(entry?.transcriptionJobId).toBe("job-new");
  });

  test("the webhook's fetch writes a completed transcript", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "completed", text: "hello" })));
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "pending", "job-1");

    await t.action(internal.transcription.fetchTranscriptResult, { entryId, jobId: "job-1" });

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcript).toBe("hello");
    expect(entry?.transcriptionStatus).toBe("done");
  });

  test("retrying a job that's still queued checks once and stays retryable", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "processing", text: null }));
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "pending", "job-legacy");

    await t.action(internal.transcription.transcribeEntry, { entryId });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcriptionStatus).toBe("timed_out");
  });

  test("retrying a job that finished meanwhile writes the transcript", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "completed", text: "late" })));
    const t = convexTest(schema, modules);
    const entryId = await insertVoiceEntry(t, "pending", "job-legacy");

    await t.action(internal.transcription.transcribeEntry, { entryId });

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry?.transcript).toBe("late");
    expect(entry?.transcriptionStatus).toBe("done");
  });
});
