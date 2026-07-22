// Loose Change MCP endpoint — JSON-RPC 2.0 over HTTP, one server per token.
// URL shape: /{token}/mcp, mirroring Tangle/pctx's convention. The token is a
// coarse gate; the real auth boundary is the MCP_SHARED_SECRET check inside
// each Convex mcp* function (see src/lib/mcp.ts for why both layers exist).

import { SERVER_INFO, TOOLS, ToolError, dispatchTool, err, ok } from "@/lib/mcp";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(req: Request, context: RouteContext) {
  const { token } = await context.params;
  const expected = process.env.MCP_ACCESS_TOKEN;
  if (!expected || token !== expected) {
    return err(null, -32600, "Invalid token");
  }

  let body: { method?: string; params?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(null, -32700, "Parse error: invalid JSON");
  }
  const { method, params, id } = body;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: SERVER_INFO.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }

  if (method === "tools/list") {
    return ok(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = (params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    if (!name) return err(id, -32602, "tools/call requires `name`");

    try {
      const result = await dispatchTool(name, args ?? {});
      return ok(id, result);
    } catch (e) {
      if (e instanceof ToolError) return err(id, e.code, e.message);
      const message = e instanceof Error ? e.message : "Internal error";
      return err(id, -32603, message);
    }
  }

  return err(id, -32601, `Unknown method: ${method}`);
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
