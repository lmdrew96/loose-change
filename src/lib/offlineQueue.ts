const DB_NAME = "loose-change";
const DB_VERSION = 2;
const STORE_NAME = "pendingCaptures";
const IN_PROGRESS_STORE = "inProgressRecordings";
const TEXT_DRAFT_STORE = "textDrafts";
const TEXT_DRAFT_KEY = "current";

export type PendingCapture =
  | { localId: string; captureMode: "text"; transcript: string; capturedAt: number }
  | { localId: string; captureMode: "voice"; audioBlob: Blob; capturedAt: number };

interface InProgressRecording {
  localId: string;
  mimeType: string;
  startedAt: number;
  chunks: Blob[];
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

export async function addPendingCapture(capture: PendingCapture): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(capture);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export async function deletePendingCapture(localId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
let recordingOpsChain: Promise<void> = Promise.resolve();

function enqueueRecordingOp(op: () => Promise<void>): Promise<void> {
  recordingOpsChain = recordingOpsChain.then(op);
  return recordingOpsChain;
}

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
    tx.objectStore(IN_PROGRESS_STORE).put({ localId, mimeType, startedAt, chunks: [] });
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
    await addPendingCapture({ localId, captureMode: "voice", audioBlob, capturedAt: record.startedAt });
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
