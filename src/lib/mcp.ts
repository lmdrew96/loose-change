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
        limit: { type: "number", description: "Max entries to return. Default 20." },
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
        limit: { type: "number", description: "Default 20." },
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
    description: "Restore a discarded entry back to untriaged.",
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "string" } },
      required: ["entry_id"],
    },
  },
  {
    name: "lc_mark_promoted",
    description:
      "Flag an entry as sent elsewhere and record the destination. Does not write into Kindling or " +
      "ControlledChaos itself — call their own MCP tools separately to do that.",
    inputSchema: {
      type: "object",
      properties: {
        entry_id: { type: "string" },
        destination: { type: "string", enum: ["kindling", "controlledchaos"] },
      },
      required: ["entry_id", "destination"],
    },
  },
  {
    name: "lc_get_stats",
    description: "Untriaged count and keep/discard/promote breakdown. Informational only, no gamification.",
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

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
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
        paginationOpts: { numItems: asNumber(args.limit) ?? 20, cursor: asString(args.cursor) ?? null },
      });
      return textContent(result);
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
        limit: asNumber(args.limit),
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
      await convex.mutation(api.entries.mcpUndoDiscard, { secret, userId, entryId: entryId as Id<"entries"> });
      return textContent({ entry_id: entryId, status: "untriaged" });
    }

    case "lc_mark_promoted": {
      const entryId = asString(args.entry_id);
      const destination = asString(args.destination);
      if (!entryId || (destination !== "kindling" && destination !== "controlledchaos")) {
        throw new ToolError(
          -32602,
          "lc_mark_promoted requires entry_id and destination ('kindling' | 'controlledchaos')",
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
