# Loose Change

Frictionless voice/text capture for stray thoughts that hit while driving, falling asleep, or otherwise mid-task — the ones that aren't ControlledChaos tasks and aren't Kindling-worthy sparks. Talk or type, release, triage later in batches.

## Tech Stack

- **Framework**: Next.js (PWA)
- **Backend**: Convex
- **Auth**: Clerk
- **Language**: TypeScript
- **Transcription**: AssemblyAI
- **Deployment**: Vercel

## Core Principle

Capture must never require a decision. No tagging, no titling, no categorizing at the moment of capture — that's what makes it usable while driving or half-asleep. All triage happens later, untimed, in a separate flow.

## Screens

### 1. Record (landing screen)

One primary action: a large central record button.

- **Voice mode**: tap to start, tap to stop (no press-and-hold — needs to work one-handed while driving). Audio saves to local storage first, then background-syncs to Convex once connected. Never blocks on network. Instant "Saved ✓" feedback, returns to record button.
- **Text mode**: small keyboard icon in a corner (secondary, doesn't compete with the record button). Swaps to a minimal text input — auto-focused cursor, single Save action, no formatting toolbar. Loose Change is dark-only by design app-wide (no light theme or toggle), which suits typing in bed as well as anywhere else.
- Both modes write to the same entry schema, differentiated by `captureMode: "voice" | "text" | "chat"`.

### 2. Inbox

- Reverse-chronological, **paginated — not infinite scroll**.
- Each card: transcript preview, timestamp, small icon for capture mode (mic / keyboard / chat-bubble).
- Untriaged count shown as a plain number. No red badges, no streaks, no "you're behind" framing.

### 3. Triage (one entry at a time)

Four fixed-position actions, always in the same place:

| Action | Behavior |
|---|---|
| **Keep** | Moves to searchable archive |
| **Discard** | Soft-delete, 30-day undo window (not instant-gone) |
| **Send to Kindling** | Hands off transcript text; Kindling's own MCP does the actual write |
| **Send to CC** | Hands off transcript text; ControlledChaos's own MCP does the actual write |

Untimed. No countdown. No forced review cadence — if you never triage, the inbox just sits there.

## Data Model (Convex)

```
entries {
  _id
  userId
  captureMode: "voice" | "text" | "chat"
  transcript: string | null       // null until transcription completes (voice only)
  audioStorageId: string | null   // Convex storage ref; null for text/chat entries
  transcriptionStatus: "n/a" | "pending" | "done" | "failed"
  status: "untriaged" | "kept" | "discarded" | "promoted"
  promotedTo: "kindling" | "controlledchaos" | null
  discardedAt: number | null       // used for the 30-day undo window
  audioDeletedAt: number | null    // set once retention cleanup removes the blob
  createdAt: number
}
```

## Transcription Pipeline

- Convex action triggers on audio sync completion.
- Calls AssemblyAI, writes result to `transcript`, sets `transcriptionStatus: "done"`.
- Never blocks capture — entry shows "transcribing…" in the inbox until it resolves.
- No retry-transcription UI in v1. If a transcript comes back garbled, the audio stays playable alongside it — that's the fallback, not a re-run button.

## Audio Retention

Scheduled Convex function: once an entry's `status` is `kept`, `discarded`, or `promoted` **and** 30 days have elapsed, delete the audio blob and clear `audioStorageId`; keep the transcript. Untriaged entries retain audio indefinitely.

## MCP Tools (`lc_` prefix)

Single-responsibility: `lc_mark_promoted` only logs where an entry went. It does not write into Kindling or ControlledChaos directly — that happens via their own MCP tools, called separately.

| Tool | Purpose |
|---|---|
| `lc_list_inbox` | Paginated, untriaged entries, newest first |
| `lc_get_entry` | Full entry: transcript, audio ref, timestamp, capture mode |
| `lc_search` | Full-text search across kept/archived entries |
| `lc_keep` | Mark an entry kept |
| `lc_discard` | Soft-delete (starts the 30-day undo window) |
| `lc_undo_discard` | Restore a discarded entry |
| `lc_mark_promoted` | Flag an entry as sent elsewhere + record destination |
| `lc_get_stats` | Untriaged count, keep/discard/promote breakdown — informational only, no gamification |
| `lc_capture_text` | Capture a thought directly from a chat conversation (`captureMode: "chat"`), skipping the app entirely |

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `CONVEX_DEPLOYMENT` | Convex project deployment URL | Yes |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth | Yes |
| `CLERK_SECRET_KEY` | Clerk auth | Yes |
| `ASSEMBLYAI_API_KEY` | Transcription | Yes |

## Design Constraints (do not violate)

- No autoplay audio/animation.
- No infinite scroll anywhere.
- No shame mechanics — no streaks, no "you haven't reviewed in N days" nudges.
- No forced categorization at capture time.
- Every destructive action (Discard) is reversible for 30 days.
- One primary action per screen — Record screen especially.

## Build Order

1. Record screen (voice + text)
2. Transcription pipeline
3. Inbox screen
4. Triage flow
5. Audio retention job
6. MCP server (`lc_` tools)
7. Full-text search

Steps 1–4 form a usable end-to-end app; 5–7 layer on top.

## Related ChaosPatch Project

Full patch breakdown with notes lives in ChaosPatch under the `loose-change` project slug.
