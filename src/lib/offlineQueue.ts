import { createSerialQueue } from "./serialQueue";

const DB_NAME = "loose-change";
const DB_VERSION = 2;
const STORE_NAME = "pendingCaptures";
const IN_PROGRESS_STORE = "inProgressRecordings";
const TEXT_DRAFT_STORE = "textDrafts";
const TEXT_DRAFT_KEY = "current";

// Sync failure bookkeeping, shared by both capture arms. Optional because
// records queued before these fields existed have neither.
type SyncFailureInfo = { attempts?: number; lastError?: string; lastAttemptAt?: number };

// The account a capture was made under. Absent on captures queued before this
// existed; those go to whichever account syncs first, as they always did.
type Ownership = { userId?: string };

export type PendingCapture = (
  | { localId: string; captureMode: "text"; transcript: string; capturedAt: number }
  | { localId: string; captureMode: "voice"; audioBlob: Blob; capturedAt: number }
) &
  SyncFailureInfo &
  Ownership;

// Past this many failed sync passes a capture is shown as stuck rather than
// waiting. It keeps retrying regardless — being stuck only changes how it's
// shown, and dropping it is always the user's explicit choice, never automatic.
export const STUCK_AFTER_ATTEMPTS = 5;

export function isStuck(capture: PendingCapture): boolean {
  return (capture.attempts ?? 0) >= STUCK_AFTER_ATTEMPTS;
}

// Automatic retries of a failing capture wait 30s, 1m, 2m, 4m… capped at an
// hour, so a capture that can't succeed isn't re-uploaded on every sync pass.
// "Try again now" in Settings ignores this.
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 60 * 60_000;

export function isDueForRetry(capture: PendingCapture, now: number): boolean {
  const attempts = capture.attempts ?? 0;
  // Never failed, or failed before lastAttemptAt was tracked: no delay.
  if (attempts === 0 || capture.lastAttemptAt === undefined) return true;
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempts - 1), RETRY_MAX_DELAY_MS);
  return now - capture.lastAttemptAt >= delay;
}

const MAX_ERROR_LENGTH = 300;

interface InProgressRecording {
  localId: string;
  mimeType: string;
  startedAt: number;
  chunks: Blob[];
  userId?: string;
}

// ── Capture ownership ───────────────────────────────────────────────────────
// Captures used to carry no user id, so anything still queued at sign-out
// synced into whichever account signed in next on this device. Each capture
// is now stamped with the signed-in user, and only that user's captures sync.

const OWNER_KEY = "loose-change:capture-owner";

// Set from Clerk once it has loaded (OfflineSyncBootstrap). Null means signed
// out, or Clerk hasn't loaded yet.
let signedInUser: string | null = null;

/** Called whenever Clerk reports who's signed in (null once signed out). */
export function setSignedInUser(userId: string | null): void {
  signedInUser = userId;
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Storage blocked: stamping just falls back to the in-memory value.
  }
  notifyPendingCapturesChanged();
}

/** Who's signed in right now, per Clerk. What sync checks against. */
export function getSignedInUser(): string | null {
  return signedInUser;
}

/**
 * Who a new capture belongs to. An offline cold start never loads Clerk, so
 * this falls back to the last user seen on this device (cleared on sign-out).
 */
export function getCaptureOwner(): string | null {
  if (signedInUser) return signedInUser;
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/** Stamps a capture with its owner unless it already has one. */
export function withOwner<T extends Ownership>(capture: T, owner: string | null): T {
  if (capture.userId !== undefined || owner === null) return capture;
  return { ...capture, userId: owner };
}

/**
 * Whether `userId` may see and sync this capture. Unstamped (legacy) captures
 * belong to whoever is signed in; a stamped one only to its own account.
 */
export function belongsToUser(capture: Ownership, userId: string | null): boolean {
  if (capture.userId === undefined) return true;
  return capture.userId === userId;
}

/** Pending captures the current owner should see or sync. */
export async function getOwnPendingCaptures(): Promise<PendingCapture[]> {
  const owner = getCaptureOwner();
  return (await getPendingCaptures()).filter((c) => belongsToUser(c, owner));
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "localId" });
      }
      if (!db.objectStoreNames.contains(IN_PROGRESS_STORE)) {
        db.createObjectStore(IN_PROGRESS_STORE, { keyPath: "localId" });
      }
      if (!db.objectStoreNames.contains(TEXT_DRAFT_STORE)) {
        db.createObjectStore(TEXT_DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Notified whenever the pending-captures store changes, so the UI can show
// a live count without polling IndexedDB on a timer.
const pendingChangeListeners = new Set<() => void>();

export function subscribePendingCaptures(listener: () => void): () => void {
  pendingChangeListeners.add(listener);
  return () => pendingChangeListeners.delete(listener);
}

function notifyPendingCapturesChanged(): void {
  for (const listener of pendingChangeListeners) listener();
}

export async function addPendingCapture(capture: PendingCapture): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(withOwner(capture, getCaptureOwner()));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyPendingCapturesChanged();
}

export async function getPendingCaptures(): Promise<PendingCapture[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as PendingCapture[]);
    request.onerror = () => reject(request.error);
  });
}

// Read-modify-write inside one transaction, so it can't clobber a concurrent
// delete. A capture that was deleted meanwhile (synced elsewhere, discarded)
// is left deleted rather than resurrected.
export async function recordSyncFailure(localId: string, error: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const capture = getReq.result as PendingCapture | undefined;
      if (!capture) return;
      store.put({
        ...capture,
        attempts: (capture.attempts ?? 0) + 1,
        lastError: error.slice(0, MAX_ERROR_LENGTH),
        lastAttemptAt: Date.now(),
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyPendingCapturesChanged();
}

export async function deletePendingCapture(localId: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyPendingCapturesChanged();
}

// ── In-progress voice recordings ──────────────────────────────────────────
// Chunks are persisted as they arrive (via MediaRecorder's timeslice) rather
// than only at recorder.onstop, so a recording survives the app/tab being
// killed mid-capture (e.g. a phone call interrupting a driving user) — only
// audio since the last flushed chunk is at risk, not the whole recording.

// Recording setup and chunk appends are serialized through a single chain —
// without it, (a) a chunk could try to append before the record exists yet
// (startInProgressRecording's write racing the first ondataavailable), or
// (b) two concurrent read-modify-writes on the same record could race and
// silently drop a chunk. Chaining preserves call order regardless of how
// long each individual IndexedDB operation takes.
const enqueueRecordingOp = createSerialQueue();

export function startInProgressRecording(localId: string, mimeType: string, startedAt: number): Promise<void> {
  return enqueueRecordingOp(() => startInProgressRecordingInternal(localId, mimeType, startedAt));
}

async function startInProgressRecordingInternal(
  localId: string,
  mimeType: string,
  startedAt: number,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IN_PROGRESS_STORE, "readwrite");
    const record = withOwner<InProgressRecording>({ localId, mimeType, startedAt, chunks: [] }, getCaptureOwner());
    tx.objectStore(IN_PROGRESS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function appendRecordingChunk(localId: string, chunk: Blob): Promise<void> {
  return enqueueRecordingOp(() => appendChunkInternal(localId, chunk));
}

async function appendChunkInternal(localId: string, chunk: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IN_PROGRESS_STORE, "readwrite");
    const store = tx.objectStore(IN_PROGRESS_STORE);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const record = getReq.result as InProgressRecording | undefined;
      if (!record) return; // already finalized elsewhere; drop the chunk
      record.chunks.push(chunk);
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Merges whatever chunks exist into a pending capture (if any) and clears
// the in-progress record. Returns whether a capture was created — false for
// a recording that never captured any audio (e.g. a sub-second accidental tap).
export async function finalizeInProgressRecording(localId: string): Promise<boolean> {
  const db = await openDB();
  const record = await new Promise<InProgressRecording | undefined>((resolve, reject) => {
    const tx = db.transaction(IN_PROGRESS_STORE, "readonly");
    const req = tx.objectStore(IN_PROGRESS_STORE).get(localId);
    req.onsuccess = () => resolve(req.result as InProgressRecording | undefined);
    req.onerror = () => reject(req.error);
  });

  let saved = false;
  if (record && record.chunks.length > 0) {
    const audioBlob = new Blob(record.chunks, { type: record.mimeType });
    // The recording's own owner, not whoever is signed in now — a salvaged
    // recording may be finalized after an account switch.
    await addPendingCapture({
      localId,
      captureMode: "voice",
      audioBlob,
      capturedAt: record.startedAt,
      userId: record.userId,
    });
    saved = true;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IN_PROGRESS_STORE, "readwrite");
    tx.objectStore(IN_PROGRESS_STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return saved;
}

// Discards an in-progress recording without turning it into a pending
// capture — used when the user explicitly cancels mid-recording (e.g. a
// pocket-dial) so it never flows into the queue → transcription → inbox
// pipeline.
export async function cancelInProgressRecording(localId: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IN_PROGRESS_STORE, "readwrite");
    tx.objectStore(IN_PROGRESS_STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Called once at app boot: any in-progress recording still present means the
// app was killed before Stop was tapped. Salvages whatever was captured.
export async function salvageOrphanedRecordings(): Promise<void> {
  const db = await openDB();
  const records = await new Promise<InProgressRecording[]>((resolve, reject) => {
    const tx = db.transaction(IN_PROGRESS_STORE, "readonly");
    const req = tx.objectStore(IN_PROGRESS_STORE).getAll();
    req.onsuccess = () => resolve(req.result as InProgressRecording[]);
    req.onerror = () => reject(req.error);
  });
  for (const record of records) {
    await finalizeInProgressRecording(record.localId);
  }
}

// ── Text-mode draft ───────────────────────────────────────────────────────
// Debounce-saved while typing so navigating away (or the app closing) before
// tapping Save doesn't lose the draft. Deliberately kept separate from
// pendingCaptures — a draft isn't a capture yet, so it must never get synced
// mid-thought; it only becomes a real capture when the user taps Save.

export async function saveDraftText(text: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_DRAFT_STORE, "readwrite");
    tx.objectStore(TEXT_DRAFT_STORE).put(text, TEXT_DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDraftText(): Promise<string> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_DRAFT_STORE, "readonly");
    const req = tx.objectStore(TEXT_DRAFT_STORE).get(TEXT_DRAFT_KEY);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? "");
    req.onerror = () => reject(req.error);
  });
}

export async function clearDraftText(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_DRAFT_STORE, "readwrite");
    tx.objectStore(TEXT_DRAFT_STORE).delete(TEXT_DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
