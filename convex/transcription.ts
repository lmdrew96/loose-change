import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

// AssemblyAI calls back here when a job finishes, sending this header with
// ASSEMBLYAI_WEBHOOK_SECRET so the endpoint can't be spoofed into writing
// arbitrary transcripts. See http.ts.
export const WEBHOOK_PATH = "/assemblyai-webhook";
export const WEBHOOK_AUTH_HEADER = "X-Loose-Change-Webhook-Secret";

type TranscriptResult = {
  status: "queued" | "processing" | "completed" | "error";
  text: string | null;
  error?: string;
};

async function fetchTranscript(apiKey: string, jobId: string): Promise<TranscriptResult> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${jobId}`, {
    headers: { authorization: apiKey },
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI fetch failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TranscriptResult;
}

export const transcribeEntry = internalAction({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    const webhookSecret = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!apiKey || !webhookSecret || !siteUrl) {
      console.error("ASSEMBLYAI_API_KEY, ASSEMBLYAI_WEBHOOK_SECRET or CONVEX_SITE_URL not set; skipping transcription");
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
      return;
    }

    const job = await ctx.runQuery(internal.entries.getTranscriptionJob, { entryId });
    if (!job) {
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
      return;
    }

    try {
      // A retry already has a job in AssemblyAI's queue — check on that one
      // rather than submitting a second copy behind it. Once, not in a loop.
      if (job.jobId !== undefined) {
        const result = await fetchTranscript(apiKey, job.jobId);
        if (result.status === "completed") {
          await ctx.runMutation(internal.entries.setTranscript, { entryId, transcript: result.text ?? "" });
        } else if (result.status === "error") {
          throw new Error(result.error ?? "AssemblyAI transcription error");
        } else {
          // Still in their queue. Stays retryable; if this job was submitted
          // with a webhook, that resolves it whenever it lands.
          await ctx.runMutation(internal.entries.setTranscriptionTimedOut, { entryId });
        }
        return;
      }

      // The entry id rides on the webhook URL so the callback can find its
      // entry even if it arrives before setTranscriptionJobId commits.
      const webhookUrl = `${siteUrl}${WEBHOOK_PATH}?entryId=${encodeURIComponent(entryId)}`;
      const submitRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
        method: "POST",
        headers: {
          authorization: apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          audio_url: job.audioUrl,
          webhook_url: webhookUrl,
          webhook_auth_header_name: WEBHOOK_AUTH_HEADER,
          webhook_auth_header_value: webhookSecret,
        }),
      });
      if (!submitRes.ok) {
        throw new Error(`AssemblyAI submit failed: ${submitRes.status} ${await submitRes.text()}`);
      }
      const { id } = (await submitRes.json()) as { id: string };
      await ctx.runMutation(internal.entries.setTranscriptionJobId, { entryId, jobId: id });
      // Nothing more to do here: the entry stays "pending" until the webhook.
    } catch (err) {
      console.error("Transcription failed:", err);
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
    }
  },
});

// Scheduled by the webhook, which has to answer AssemblyAI within 10s. The
// webhook body carries only the job id and status, so the text is fetched here.
export const fetchTranscriptResult = internalAction({
  args: { entryId: v.string(), jobId: v.string() },
  handler: async (ctx, { entryId: rawEntryId, jobId }) => {
    const entryId = await ctx.runQuery(internal.entries.getEntryAwaitingTranscript, {
      entryId: rawEntryId,
      jobId,
    });
    // Unknown entry, a different job, or already resolved — nothing to write.
    if (!entryId) return;

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      console.error("ASSEMBLYAI_API_KEY not set; can't fetch transcript", jobId);
      await ctx.runMutation(internal.entries.setTranscriptionTimedOut, { entryId });
      return;
    }

    let result: TranscriptResult;
    try {
      result = await fetchTranscript(apiKey, jobId);
    } catch (err) {
      // The job is done on AssemblyAI's side; only reading it failed. Leave it
      // retryable — a retry re-reads the same job.
      console.error("Couldn't fetch finished transcript; retryable:", jobId, err);
      await ctx.runMutation(internal.entries.setTranscriptionTimedOut, { entryId });
      return;
    }

    if (result.status === "completed") {
      await ctx.runMutation(internal.entries.setTranscript, { entryId, transcript: result.text ?? "" });
    } else if (result.status === "error") {
      console.error("Transcription failed:", jobId, result.error);
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
    }
  },
});
