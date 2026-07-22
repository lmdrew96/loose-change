import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./authHelpers";

// Length is generous since this draws from Math.random() (Convex mutations
// can't use Node's crypto — see runtime restrictions), not a real CSPRNG.
function generateToken(): string {
  let token = "";
  for (let i = 0; i < 6; i++) {
    token += Math.random().toString(36).slice(2);
  }
  return token.slice(0, 40);
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
