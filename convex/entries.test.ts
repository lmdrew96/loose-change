import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const MCP_SECRET = "test-shared-secret";
process.env.MCP_SHARED_SECRET = MCP_SECRET;

async function createOwnedEntry(t: ReturnType<typeof convexTest>, ownerId: string) {
  const owner = t.withIdentity({ subject: ownerId });
  const entryId = await owner.mutation(api.entries.createTextEntry, {
    transcript: "mine",
    capturedAt: Date.now(),
    captureMode: "text",
  });
  return entryId;
}

describe("requireOwnedEntry (Clerk-authed path)", () => {
  test("a different user cannot keep another user's entry", async () => {
    const t = convexTest(schema, modules);
    const entryId = await createOwnedEntry(t, "user_owner");

    const intruder = t.withIdentity({ subject: "user_intruder" });
    await expect(intruder.mutation(api.entries.keepEntry, { entryId })).rejects.toThrow("Entry not found");
  });

  test("a different user cannot discard another user's entry", async () => {
    const t = convexTest(schema, modules);
    const entryId = await createOwnedEntry(t, "user_owner");

    const intruder = t.withIdentity({ subject: "user_intruder" });
    await expect(intruder.mutation(api.entries.discardEntry, { entryId })).rejects.toThrow("Entry not found");
  });

  test("an unauthenticated caller is rejected before ownership is even checked", async () => {
    const t = convexTest(schema, modules);
    const entryId = await createOwnedEntry(t, "user_owner");

    await expect(t.mutation(api.entries.keepEntry, { entryId })).rejects.toThrow("Not authenticated");
  });
});

describe("requireMcpSecret (MCP-authed path)", () => {
  test("wrong secret is rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.entries.mcpCaptureText, { secret: "wrong-secret", userId: "user_x", transcript: "hi" }),
    ).rejects.toThrow("Invalid MCP secret");
  });

  test("missing secret is rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.entries.mcpCaptureText, { secret: "", userId: "user_x", transcript: "hi" }),
    ).rejects.toThrow("Invalid MCP secret");
  });

  test("a correct secret still cannot reach another user's entry", async () => {
    const t = convexTest(schema, modules);
    const entryId = await createOwnedEntry(t, "user_owner");

    await expect(
      t.query(api.entries.mcpGetEntry, { secret: MCP_SECRET, userId: "user_intruder", entryId }),
    ).rejects.toThrow("Entry not found");
  });

  test("a correct secret with the owning userId succeeds", async () => {
    const t = convexTest(schema, modules);
    const entryId = await createOwnedEntry(t, "user_owner");

    const entry = await t.query(api.entries.mcpGetEntry, {
      secret: MCP_SECRET,
      userId: "user_owner",
      entryId,
    });
    expect(entry._id).toBe(entryId);
  });
});
