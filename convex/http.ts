import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { WEBHOOK_AUTH_HEADER, WEBHOOK_PATH } from "./transcription";

const http = httpRouter();

http.route({
  path: WEBHOOK_PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
    if (!expected || request.headers.get(WEBHOOK_AUTH_HEADER) !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }

    const entryId = new URL(request.url).searchParams.get("entryId");
    let jobId: unknown;
    try {
      jobId = ((await request.json()) as { transcript_id?: unknown }).transcript_id;
    } catch {
      jobId = undefined;
    }
    if (!entryId || typeof jobId !== "string") {
      return new Response("Bad request", { status: 400 });
    }

    // Answer straight away; AssemblyAI gives up on a webhook after 10s.
    await ctx.scheduler.runAfter(0, internal.transcription.fetchTranscriptResult, { entryId, jobId });
    return new Response(null, { status: 200 });
  }),
});

export default http;
