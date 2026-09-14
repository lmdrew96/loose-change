import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 30;

// Thrown only when polling runs out, so the catch can record a timeout
// separately from every other failure. A timeout bounds AssemblyAI's queue
// depth, not the audio — it's the one outcome worth retrying.
class TranscriptionTimeoutError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const transcribeEntry = internalAction({
  args: { entryId: v.id("entries") },
  handler: async (ctx, { entryId }) => {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      console.error("ASSEMBLYAI_API_KEY not set; skipping transcription");
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
      return;
    }

    const job = await ctx.runQuery(internal.entries.getTranscriptionJob, { entryId });
    if (!job) {
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
      return;
    }

    try {
      // A retry after a timeout already has a job in AssemblyAI's queue —
      // re-poll that rather than submitting a second copy behind it.
      let id = job.jobId;
      if (id === undefined) {
        const submitRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
          method: "POST",
          headers: {
            authorization: apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ audio_url: job.audioUrl }),
        });
        if (!submitRes.ok) {
          throw new Error(`AssemblyAI submit failed: ${submitRes.status} ${await submitRes.text()}`);
        }
        id = ((await submitRes.json()) as { id: string }).id;
        await ctx.runMutation(internal.entries.setTranscriptionJobId, { entryId, jobId: id });
      }

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        const pollRes = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
          headers: { authorization: apiKey },
        });
        if (!pollRes.ok) {
          throw new Error(`AssemblyAI poll failed: ${pollRes.status} ${await pollRes.text()}`);
        }
        const result = (await pollRes.json()) as {
          status: "queued" | "processing" | "completed" | "error";
          text: string | null;
          error?: string;
        };

        if (result.status === "completed") {
          await ctx.runMutation(internal.entries.setTranscript, {
            entryId,
            transcript: result.text ?? "",
          });
          return;
        }
        if (result.status === "error") {
          throw new Error(result.error ?? "AssemblyAI transcription error");
        }
      }
      throw new TranscriptionTimeoutError("AssemblyAI transcription timed out");
    } catch (err) {
      if (err instanceof TranscriptionTimeoutError) {
        console.warn("Transcription timed out; retryable:", entryId);
        await ctx.runMutation(internal.entries.setTranscriptionTimedOut, { entryId });
        return;
      }
      console.error("Transcription failed:", err);
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
    }
  },
});
