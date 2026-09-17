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
- **Offline**: the service worker caches the Record shell after the first signed-in visit, so opening the installed app with no signal lands on Record and capture works. Inbox / Triage / Kept / Search need the network and fall back to `/offline`.
- **Sync status**: "N pending sync" counts captures waiting to upload. A capture that fails 5 sync passes is shown separately as "couldn't sync" and links to Settings, where you can hear/read it, see the last error, retry, or discard it. It never gets dropped automatically.
- **Text mode**: small keyboard icon in a corner (secondary, doesn't compete with the record button). Swaps to a minimal text input — auto-focused cursor, single Save action, no formatting toolbar. Loose Change is dark-only by design app-wide (no light theme or toggle), which suits typing in bed as well as anywhere else.
- Both modes write to the same entry schema, differentiated by `captureMode: "voice" | "text" | "chat"`.

### Navigation

Every screen except Record has the same bar along the bottom: Record · Inbox · Triage · Archive · Search · Settings, icons with text labels, the current screen marked with a bar and a bold label. Record keeps its one primary action and its Inbox link instead.

### 2. Inbox

- A full-width **Triage N** button at the top whenever there's anything to triage.
- Reverse-chronological, **paginated — not infinite scroll**.
- Each card: transcript preview, timestamp, small icon for capture mode (mic / keyboard / chat-bubble).
- Untriaged count shown as a plain number. No red badges, no streaks, no "you're behind" framing.

### 3. Archive (`/kept`)

Reverse-chronological, paginated, filtered by status: **Kept**, **Sent on** (promoted), **Discarded**. Every card expands in place to show the full transcript and — for voice entries whose audio hasn't aged out — a player. Discarded entries can be restored here for as long as their 30-day window is open, and each one says how many days it has left.

### 4. Triage (one entry at a time)

Four fixed-position actions, always in the same place:

| Action | Behavior |
|---|---|
| **Keep** | Moves to searchable archive |
| **Discard** | Soft-delete, 30-day undo window (not instant-gone) |
| **Send to Kindling** | Hands off transcript text; Kindling's own MCP does the actual write |
| **Send to CC** | Hands off transcript text; ControlledChaos's own MCP does the actual write |

Every decision shows an **Undo** toast for a few seconds: Keep and Send go back to the Inbox, Discard restores. Kept and sent entries can also be moved back later with **Move to Inbox** in Archive or Search.

Plus **Skip for now** (or `S`), which advances without deciding — a skipped entry stays untriaged and comes back next session. Keyboard: `K` keep, `D` discard, `S` skip.

Untimed. No countdown. No forced review cadence — if you never triage, the inbox just sits there.

## Data Model (Convex)

```
entries {
  _id
  userId
  captureMode: "voice" | "text" | "chat"
  transcript: string | null       // null until transcription completes (voice only)
  audioStorageId: string | null   // Convex storage ref; null for text/chat entries
  transcriptionStatus: "n/a" | "pending" | "done" | "failed" | "timed_out"
  transcriptionJobId?: string      // AssemblyAI job id; a retry re-polls it instead of resubmitting
  status: "untriaged" | "kept" | "discarded" | "promoted"
  promotedTo: "kindling" | "controlledchaos" | "threadnotes" | "tangle" | "chaospatch" | null
  discardedAt: number | null       // when discarded; the 30-day purge measures from here
  discardedFromStatus?: "untriaged" | "kept" | "promoted"  // what undo restores to
  audioDeletedAt: number | null    // set once retention cleanup removes the blob
  triagedAt?: number               // when it left the untriaged pool; audio retention
                                   // measures from here. Absent while untriaged.
  createdAt: number
}
```

## Transcription Pipeline

- Convex action triggers on audio sync completion and submits the audio to AssemblyAI with a `webhook_url` pointing at the Convex HTTP action `/assemblyai-webhook` (see `convex/http.ts`). No polling, so there's no ceiling to time out against.
- AssemblyAI calls back when the job finishes, with the `X-Loose-Change-Webhook-Secret` header set to `ASSEMBLYAI_WEBHOOK_SECRET`. A call without the right secret gets a 401 and writes nothing. The webhook only carries the job id, so a scheduled action fetches the text and sets `transcriptionStatus: "done"`. Only an entry still waiting on that exact job is written.
- Never blocks capture — entry shows "transcribing…" in the inbox until it resolves.
- `timed_out` is retryable: expand the card and **Try transcribing again**, which checks the job already in AssemblyAI's queue once rather than resubmitting. It's what entries from the polling era landed in, what a retry of a still-queued job returns to, and what a webhook becomes if its transcript couldn't be read.
- `failed` (bad key, API error, undecodable audio) has no retry. If a transcript comes back garbled, the audio stays playable alongside it — that's the fallback, not a re-run button.

## Retention

Two scheduled Convex functions, both daily.

**Audio** — once an entry's `status` is `kept`, `discarded`, or `promoted` **and** 30 days have elapsed *since it was triaged* (`triagedAt`, not `createdAt`), delete the audio blob and clear `audioStorageId`; keep the transcript. Untriaged entries retain audio indefinitely. Undoing a discard back to `untriaged` clears `triagedAt`; undoing back to `kept`/`promoted` restarts the 30 days, so an undo never costs you the audio.

**Discarded entries** — 30 days after `discardedAt`, the entry is deleted outright (blob first, then the row). This is what closes the undo window: before it existed, "reversible for 30 days" had no closing edge and discarded memos stayed searchable forever.

## MCP Tools (`lc_` prefix)

Single-responsibility: `lc_mark_promoted` only logs where an entry went. It does not write into the destination app directly — that happens via that app's own MCP tools, called separately. Destinations: `kindling`, `controlledchaos`, `threadnotes`, `tangle`, `chaospatch`.

Triage's two one-tap handoff buttons stay Kindling and ControlledChaos — the README's four-fixed-actions constraint rules out a button per destination. The other three are recorded via `lc_mark_promoted` from an MCP client.

| Tool | Purpose |
|---|---|
| `lc_list_inbox` | Paginated, untriaged entries, newest first |
| `lc_list_archive` | Paginated triaged entries: `kept` (default), `promoted`, or `discarded` |
| `lc_get_entry` | Full entry: transcript, audio ref, timestamp, capture mode |
| `lc_search` | Full-text search across transcripts, optionally filtered by status |
| `lc_keep` | Mark an entry kept |
| `lc_discard` | Soft-delete (starts the 30-day undo window) |
| `lc_undo_discard` | Restore a discarded entry to the status it was discarded from |
| `lc_return_to_inbox` | Move a kept, sent or discarded entry back to the inbox (the undo for keep/send) |
| `lc_mark_promoted` | Flag an entry as sent elsewhere + record destination |
| `lc_retry_transcription` | Retry a voice memo whose transcription timed out |
| `lc_get_stats` | Untriaged count, keep/discard/promote breakdown — informational only, no gamification |
| `lc_capture_text` | Capture a thought directly from a chat conversation (`captureMode: "chat"`), skipping the app entirely |

### MCP ↔ UI parity

Anything the MCP tools can do is doable in the app, and vice versa. `src/lib/mcp.test.ts` asserts this — each tool declares where it lives in the UI, so adding one without a UI path fails the suite rather than shipping a capability only Claude can reach.

| Tool | Where it is in the app |
|---|---|
| `lc_list_inbox` | Inbox |
| `lc_list_archive` | Archive — Kept / Sent on / Discarded tabs |
| `lc_get_entry` | Tap any card to expand it |
| `lc_search` | Search — query box plus status filter chips |
| `lc_keep` | Triage Keep, `K`, swipe right; Keep from Search |
| `lc_discard` | Triage Discard, `D`, swipe left; trash from Archive and Search |
| `lc_undo_discard` | Triage undo toast; Restore from Archive and Search |
| `lc_return_to_inbox` | Triage Undo after Keep or Send; **Move to Inbox** in Archive and Search |
| `lc_mark_promoted` | Triage destination buttons, plus **More destinations** |
| `lc_retry_transcription` | Expand a timed-out voice memo → Try transcribing again |
| `lc_get_stats` | Settings → Your captures |
| `lc_capture_text` | Record → text mode |

Five capabilities are deliberately app-only:

- **Voice capture** — binary audio doesn't fit JSON-RPC, and an MCP client has no microphone. `lc_capture_text` is the analogue.
- **MCP token generate / regenerate** — it bootstraps MCP access, so exposing it over MCP would be circular.
- **Push subscribe / unsubscribe** — a per-device browser permission, meaningless from a server-side client.
- **Triage Skip** — moves an ephemeral cursor and persists nothing, so there's no state for a tool to change.
- **Stuck capture inspect / discard** — the capture lives only in the device's IndexedDB; it never reached the server, so there's nothing for a tool to see.

## Deploying

A push to `main` deploys the Convex functions and the frontend together. `vercel.json` sets Vercel's build command to:

- **Production builds**: `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`. Convex pushes functions first (typecheck, codegen, schema), then runs `next build` with the production deployment's URL injected. If the Convex push fails, the whole build fails, so a frontend can never ship expecting functions the backend doesn't have.
- **Preview builds**: plain `pnpm build`, no Convex deploy. Previews can't overwrite production functions.

`pnpm build` locally is just `next build` and never deploys anything. Use `npx convex dev` for the dev deployment.

Convex refuses to deploy if `auth.config.ts` references an env var the target deployment doesn't have, but it does **not** check the others (they're read at runtime). When adding a Convex env var, set it on the production deployment in the Convex dashboard *before* pushing code that reads it.

## Environment Variables

These live in two different places.

### Vercel (Project → Settings → Environment Variables)

| Variable | Description | Required |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | Production deploy key (Convex dashboard → production deployment → Settings → Deploy keys). Scope to **Production only**. | Yes |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL. Injected by `convex deploy` on production builds; still needed for preview builds. | Yes |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth | Yes |
| `CLERK_SECRET_KEY` | Clerk auth | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in` and `/sign-up` (embedded pages, not Clerk's hosted portal) | Yes |
| `MCP_SHARED_SECRET` | Authenticates the MCP route to Convex. Must be identical to the Convex value. | Yes |

### Convex (dashboard → deployment → Settings → Environment Variables)

| Variable | Description | Required |
|---|---|---|
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk JWT template issuer; read by `auth.config.ts` | Yes |
| `ASSEMBLYAI_API_KEY` | Transcription | Yes |
| `ASSEMBLYAI_WEBHOOK_SECRET` | Any long random string. Authenticates AssemblyAI's webhook calls; without it, new voice memos are marked failed. | Yes |
| `MCP_SHARED_SECRET` | Must match the Vercel value, or every MCP call fails "Invalid MCP secret" | Yes |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push reminders | Yes |

Locally, `.env.local` holds both sets (see `.env.example`) and `CONVEX_DEPLOYMENT` is written by `npx convex dev`.

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
