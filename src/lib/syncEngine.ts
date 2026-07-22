import { convexClient } from "@/components/ConvexClientProvider";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getPendingCaptures, deletePendingCapture, type PendingCapture } from "./offlineQueue";

let syncing = false;

export async function syncPendingCaptures(): Promise<void> {
  if (syncing || typeof navigator === "undefined" || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await getPendingCaptures();
    for (const capture of pending) {
      try {
        await syncOne(capture);
        await deletePendingCapture(capture.localId);
      } catch (err) {
        console.error("Sync failed for capture, will retry later:", capture.localId, err);
      }
    }
  } finally {
    syncing = false;
  }
}

async function syncOne(capture: PendingCapture): Promise<void> {
  if (capture.captureMode === "text") {
    await convexClient.mutation(api.entries.createTextEntry, {
      transcript: capture.transcript,
      capturedAt: capture.capturedAt,
      captureMode: "text",
    });
    return;
  }

  const uploadUrl = await convexClient.mutation(api.entries.generateUploadUrl, {});
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": capture.audioBlob.type || "audio/webm" },
    body: capture.audioBlob,
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
  await convexClient.mutation(api.entries.createVoiceEntry, {
    audioStorageId: storageId,
    capturedAt: capture.capturedAt,
  });
}
