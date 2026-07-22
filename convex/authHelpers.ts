// Shared auth primitives for the two trust boundaries that reach Convex
// functions: the web client (Clerk session, userId derived from the JWT) and
// the MCP server (a separate Next.js route with no Clerk session, gated
// instead by a shared secret; the caller's userId comes from a per-user token
// resolved via mcpTokens, not the client). Convex has no per-function ACLs
// beyond what the handler checks, and the deployment URL/function names
// aren't secret (NEXT_PUBLIC_CONVEX_URL ships to the browser) — so mcp*
// functions must check the secret themselves, not just rely on the Next.js
// route in front of them.

export interface AuthCtx {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}

export async function requireUserId(ctx: AuthCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

export function requireMcpSecret(secret: string): void {
  const expected = process.env.MCP_SHARED_SECRET;
  if (!expected || secret !== expected) throw new Error("Invalid MCP secret");
}
