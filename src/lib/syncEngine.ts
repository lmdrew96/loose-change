import { convexClient } from "@/components/ConvexClientProvider";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  getPendingCaptures,
  deletePendingCapture,
  isDueForRetry,
  recordSyncFailure,
  type PendingCapture,
} from "./offlineQueue";

let syncing = false;

// No arguments on purpose: it's registered directly as the "online" listener,
// so it would receive the Event as its first parameter.
export async function syncPendingCaptures(): Promise<void> {
  await runSync(false);
}

// "Try again now" — retries every queued capture regardless of backoff.
export async function retryAllPendingCaptures(): Promise<void> {
  await runSync(true);
}

async function runSync(ignoreBackoff: boolean): Promise<void> {
  if (syncing || typeof navigator === "undefined" || !navigator.onLine) return;
  syncing = true;
  try {
    const now = Date.now();
    const pending = await getPendingCaptures();
    for (const capture of pending) {
      if (!ignoreBackoff && !isDueForRetry(capture, now)) continue;
      try {
        await syncOne(capture);
        await deletePendingCapture(capture.localId);
      } catch (err) {
        console.error("Sync failed for capture, will retry later:", capture.localId, err);
        // Counted so a capture that can never succeed becomes visible as stuck
        // instead of silently inflating the pending count forever. Failing to
        // record that mustn't stop the rest of the queue from syncing.
        try {
          await recordSyncFailure(capture.localId, err instanceof Error ? err.message : String(err));
        } catch (recordErr) {
          console.error("Couldn't record sync failure:", capture.localId, recordErr);
        }
      }
    }
  } finally {
    syncing = false;
  }
}

async function syncOne(capture: PendingCapture): Promise<void> {
  // localId travels with every capture so the mutation is idempotent: if a
  // previous attempt committed but its response was lost, the retry resolves
  // to the same entry instead of creating a duplicate.
  if (capture.captureMode === "text") {
    await convexClient.mutation(api.entries.createTextEntry, {
      transcript: capture.transcript,
      capturedAt: capture.capturedAt,
      captureMode: "text",
      localId: capture.localId,
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
    localId: capture.localId,
  });
}
