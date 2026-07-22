import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./authHelpers";

// 20 random bytes -> 40 hex chars. Convex's default runtime (used by
// mutations) supports the Web Crypto API even though Math.random() is
// seeded/deterministic there, so this is a real CSPRNG.
function generateToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const getOrCreateMcpToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("mcpTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return existing.token;

    const token = generateToken();
    await ctx.db.insert("mcpTokens", { userId, token, createdAt: Date.now() });
    return token;
  },
});

export const regenerateMcpToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("mcpTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const token = generateToken();
    if (existing) {
      await ctx.db.patch(existing._id, { token, createdAt: Date.now() });
    } else {
      await ctx.db.insert("mcpTokens", { userId, token, createdAt: Date.now() });
    }
    return token;
  },
});

// Public: the token IS the credential (an unguessable per-user secret), so
// this lookup doesn't need the separate MCP_SHARED_SECRET gate — that gate
// protects the mcp* functions in entries.ts, which this route calls next.
export const resolveMcpToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const record = await ctx.db
      .query("mcpTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    return record ? { userId: record.userId } : null;
  },
});
