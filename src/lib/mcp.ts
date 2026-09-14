// Loose Change MCP endpoint — JSON-RPC 2.0 over HTTP, hand-rolled (no SDK),
// mirroring the same pattern used by Tangle/pctx elsewhere in the ecosystem.
// Multi-user: the {token} path segment is a per-user credential (see
// convex/mcpTokens.ts) resolved to a userId by the route handler before
// dispatchTool is called. MCP_SHARED_SECRET is a second, separate layer —
// it proves a call reached the mcp* Convex functions via this trusted server,
// since the Convex deployment URL and function names aren't secret
// (NEXT_PUBLIC_CONVEX_URL ships to the browser) and could otherwise be called
// directly by anyone who knows a valid per-user token.

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const ok = (id: unknown, result: unknown): Response =>
  Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS_HEADERS });

export const err = (id: unknown, code: number, message: string): Response =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS_HEADERS });

const textContent = (payload: unknown) => ({
  content: [
    {
      type: "text",
      text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    },
  ],
});

export const SERVER_INFO = {
  name: "loose-change-mcp",
  version: "0.1.0",
  protocolVersion: "2024-11-05",
};

export const TOOLS = [
  {
    name: "lc_list_inbox",
    description: "Paginated, untriaged entries, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description: "Pagination cursor from a previous call's continueCursor. Omit for the first page.",
        },
        limit: { type: "number", description: "Max entries to return. Default 20, max 100." },
      },
    },
  },
  {
    name: "lc_list_archive",
    description:
      "Paginated, triaged entries, newest first — the same three views the app's Archive screen " +
      "offers: kept (default), promoted (sent to another app), or discarded (still inside their " +
      "30-day undo window).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["kept", "promoted", "discarded"],
          description: "Which archive view to list. Default 'kept'.",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from a previous call's continueCursor. Omit for the first page.",
        },
        limit: { type: "number", description: "Max entries to return. Default 20, max 100." },
      },
    },
  },
  {
    name: "lc_get_entry",
    description: "Full entry: transcript, audio ref, timestamp, capture mode.",
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "string" } },
      required: ["entry_id"],
    },
  },
  {
    name: "lc_search",
    description: "Full-text search across entries by transcript content. Optionally filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["untriaged", "kept", "discarded", "promoted"] },
        limit: { type: "number", description: "Default 20, max 100." },
      },
      required: ["query"],
    },
  },
  {
    name: "lc_keep",
    description: "Mark an entry kept.",
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "string" } },
      required: ["entry_id"],
    },
  },
  {
    name: "lc_discard",
    description: "Soft-delete an entry (starts the 30-day undo window, not instant-gone).",
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "string" } },
      required: ["entry_id"],
    },
  },
  {
    name: "lc_undo_discard",
    description:
      "Restore a discarded entry to the status it was discarded from — untriaged if it was " +
      "discarded during triage, kept if it was deleted from the archive. The response reports " +
      "where it actually landed.",
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "string" } },
      required: ["entry_id"],
    },
  },
  {
    name: "lc_mark_promoted",
    description:
      "Flag an entry as sent elsewhere and record the destination. Does not write into the destination " +
      "app itself — call that app's own MCP tools separately to do that.",
    inputSchema: {
      type: "object",
      properties: {
        entry_id: { type: "string" },
        destination: {
          type: "string",
          enum: ["kindling", "controlledchaos", "threadnotes", "tangle", "chaospatch"],
        },
      },
      required: ["entry_id", "destination"],
    },
  },
  {
    name: "lc_retry_transcription",
    description:
      "Retry a voice memo whose transcription timed out (transcriptionStatus: timed_out). Only timeouts " +
      "are retryable — a 'failed' transcription won't succeed on a re-run. Re-polls the existing " +
      "AssemblyAI job rather than resubmitting.",
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "string" } },
      required: ["entry_id"],
    },
  },
  {
    name: "lc_get_stats",
    description:
      "Untriaged count and keep/discard/promote breakdown. Counts are capped at 500 per status; " +
      "`capped: true` means at least one status hit that ceiling. Informational only, no gamification.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "lc_capture_text",
    description: "Capture a thought directly from a chat conversation, skipping the app entirely (captureMode: chat).",
    inputSchema: {
      type: "object",
      properties: { transcript: { type: "string" } },
      required: ["transcript"],
    },
  },
] as const;

export class ToolError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

const STATUSES = ["untriaged", "kept", "discarded", "promoted"] as const;
type Status = (typeof STATUSES)[number];

const DESTINATIONS = ["kindling", "controlledchaos", "threadnotes", "tangle", "chaospatch"] as const;
type Destination = (typeof DESTINATIONS)[number];

const asDestination = (v: unknown): Destination | undefined =>
  typeof v === "string" && (DESTINATIONS as readonly string[]).includes(v) ? (v as Destination) : undefined;

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
// Upper bound on any caller-supplied page size. Without it a confused client
// asking for 50,000 rows blows the Convex read limit and the tool just fails.
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const asLimit = (v: unknown): number => {
  const n = asNumber(v);
  if (n === undefined || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
};

// The three triaged views the Archive screen offers. Untriaged is deliberately
// absent — that's lc_list_inbox.
const ARCHIVE_STATUSES = ["kept", "promoted", "discarded"] as const;
type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

const asArchiveStatus = (v: unknown): ArchiveStatus | undefined =>
  typeof v === "string" && (ARCHIVE_STATUSES as readonly string[]).includes(v)
    ? (v as ArchiveStatus)
    : undefined;

const asStatus = (v: unknown): Status | undefined =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v) ? (v as Status) : undefined;

function requiredSecret(): string {
  const secret = process.env.MCP_SHARED_SECRET;
  if (!secret) throw new ToolError(-32603, "MCP server is not configured (missing MCP_SHARED_SECRET)");
  return secret;
}

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new ToolError(-32603, "NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

export const dispatchTool = async (
  name: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<ReturnType<typeof textContent>> => {
  const secret = requiredSecret();
  const convex = convexClient();

  switch (name) {
    case "lc_list_inbox": {
      const result = await convex.query(api.entries.mcpListInbox, {
        secret,
        userId,
        paginationOpts: { numItems: asLimit(args.limit), cursor: asString(args.cursor) ?? null },
      });
      return textContent(result);
    }

    case "lc_list_archive": {
      const status = asArchiveStatus(args.status) ?? "kept";
      const result = await convex.query(api.entries.mcpListByStatus, {
        secret,
        userId,
        status,
        paginationOpts: { numItems: asLimit(args.limit), cursor: asString(args.cursor) ?? null },
      });
      return textContent({ status, ...result });
    }

    case "lc_get_entry": {
      const entryId = asString(args.entry_id);
      if (!entryId) throw new ToolError(-32602, "lc_get_entry requires entry_id");
      const entry = await convex.query(api.entries.mcpGetEntry, {
        secret,
        userId,
        entryId: entryId as Id<"entries">,
      });
      return textContent(entry);
    }

    case "lc_search": {
      const query = asString(args.query);
      if (!query) throw new ToolError(-32602, "lc_search requires query");
      const results = await convex.query(api.entries.mcpSearch, {
        secret,
        userId,
        query,
        status: asStatus(args.status),
        limit: asLimit(args.limit),
      });
      return textContent({ results });
    }

    case "lc_keep": {
      const entryId = asString(args.entry_id);
      if (!entryId) throw new ToolError(-32602, "lc_keep requires entry_id");
      await convex.mutation(api.entries.mcpKeep, { secret, userId, entryId: entryId as Id<"entries"> });
      return textContent({ entry_id: entryId, status: "kept" });
    }

    case "lc_discard": {
      const entryId = asString(args.entry_id);
      if (!entryId) throw new ToolError(-32602, "lc_discard requires entry_id");
      await convex.mutation(api.entries.mcpDiscard, { secret, userId, entryId: entryId as Id<"entries"> });
      return textContent({ entry_id: entryId, status: "discarded" });
    }

    case "lc_undo_discard": {
      const entryId = asString(args.entry_id);
      if (!entryId) throw new ToolError(-32602, "lc_undo_discard requires entry_id");
      const status = await convex.mutation(api.entries.mcpUndoDiscard, {
        secret,
        userId,
        entryId: entryId as Id<"entries">,
      });
      return textContent({ entry_id: entryId, status });
    }

    case "lc_mark_promoted": {
      const entryId = asString(args.entry_id);
      const destination = asDestination(args.destination);
      if (!entryId || !destination) {
        throw new ToolError(
          -32602,
          `lc_mark_promoted requires entry_id and destination (${DESTINATIONS.join(" | ")})`,
        );
      }
      await convex.mutation(api.entries.mcpMarkPromoted, {
        secret,
        userId,
        entryId: entryId as Id<"entries">,
        destination,
      });
      return textContent({ entry_id: entryId, status: "promoted", promotedTo: destination });
    }

    case "lc_retry_transcription": {
      const entryId = asString(args.entry_id);
      if (!entryId) throw new ToolError(-32602, "lc_retry_transcription requires entry_id");
      await convex.mutation(api.entries.mcpRetryTranscription, {
        secret,
        userId,
        entryId: entryId as Id<"entries">,
      });
      return textContent({ entry_id: entryId, transcriptionStatus: "pending" });
    }

    case "lc_get_stats": {
      const stats = await convex.query(api.entries.mcpGetStats, { secret, userId });
      return textContent(stats);
    }

    case "lc_capture_text": {
      const transcript = asString(args.transcript);
      if (!transcript) throw new ToolError(-32602, "lc_capture_text requires transcript");
      const entryId = await convex.mutation(api.entries.mcpCaptureText, { secret, userId, transcript });
      return textContent({ entry_id: entryId });
    }

    default:
      throw new ToolError(-32601, `Unknown tool: ${name}`);
  }
};
