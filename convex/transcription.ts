import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 30;

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

    const audioUrl = await ctx.runQuery(internal.entries.getAudioUrlForTranscription, { entryId });
    if (!audioUrl) {
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
      return;
    }

    try {
      const submitRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
        method: "POST",
        headers: {
          authorization: apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ audio_url: audioUrl }),
      });
      if (!submitRes.ok) {
        throw new Error(`AssemblyAI submit failed: ${submitRes.status} ${await submitRes.text()}`);
      }
      const { id } = (await submitRes.json()) as { id: string };

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
      throw new Error("AssemblyAI transcription timed out");
    } catch (err) {
      console.error("Transcription failed:", err);
      await ctx.runMutation(internal.entries.setTranscriptionFailed, { entryId });
    }
  },
});
