import { beforeEach, describe, expect, test, vi } from "vitest";

const query = vi.fn();
const mutation = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = query;
    mutation = mutation;
  },
}));

process.env.MCP_SHARED_SECRET = "test-secret";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

const { TOOLS, ToolError, dispatchTool } = await import("./mcp");

const USER = "user_owner";

beforeEach(() => {
  query.mockReset().mockResolvedValue({ page: [], isDone: true });
  mutation.mockReset().mockResolvedValue("untriaged");
});

describe("tool surface", () => {
  test("every declared tool has a dispatch case", async () => {
    for (const tool of TOOLS) {
      // A tool that's advertised but unhandled would throw "Unknown tool".
      // Required args are supplied so validation isn't what's being exercised.
      await expect(
        dispatchTool(
          tool.name,
          { entry_id: "abc", query: "x", transcript: "x", destination: "kindling" },
          USER,
        ),
      ).resolves.toBeDefined();
    }
  });

  test("an unknown tool is a method-not-found error", async () => {
    await expect(dispatchTool("lc_nope", {}, USER)).rejects.toMatchObject({ code: -32601 });
  });
});

describe("argument validation", () => {
  test.each([
    ["lc_get_entry", {}],
    ["lc_keep", {}],
    ["lc_discard", {}],
    ["lc_undo_discard", {}],
    ["lc_search", {}],
    ["lc_capture_text", {}],
    ["lc_mark_promoted", { entry_id: "abc" }],
    ["lc_mark_promoted", { entry_id: "abc", destination: "somewhere-else" }],
  ])("%s rejects invalid args with -32602", async (name, args) => {
    const error = await dispatchTool(name, args, USER).catch((e) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect(error.code).toBe(-32602);
  });

  test("lc_mark_promoted accepts every destination it advertises", async () => {
    const tool = TOOLS.find((t) => t.name === "lc_mark_promoted")!;
    const destinations = tool.inputSchema.properties.destination.enum;
    for (const destination of destinations) {
      await expect(
        dispatchTool("lc_mark_promoted", { entry_id: "abc", destination }, USER),
      ).resolves.toBeDefined();
    }
  });
});

describe("page size clamping", () => {
  const limitOf = () => query.mock.calls.at(-1)![1].paginationOpts.numItems;

  test("defaults to 20 when absent or nonsense", async () => {
    await dispatchTool("lc_list_inbox", {}, USER);
    expect(limitOf()).toBe(20);
    await dispatchTool("lc_list_inbox", { limit: 0 }, USER);
    expect(limitOf()).toBe(20);
    await dispatchTool("lc_list_inbox", { limit: "many" }, USER);
    expect(limitOf()).toBe(20);
  });

  test("clamps to 100 so a confused client can't blow the read limit", async () => {
    await dispatchTool("lc_list_inbox", { limit: 50000 }, USER);
    expect(limitOf()).toBe(100);
    await dispatchTool("lc_list_kept", { limit: 50000 }, USER);
    expect(limitOf()).toBe(100);
  });
});

describe("reported outcomes", () => {
  test("lc_undo_discard reports where the entry actually landed", async () => {
    // The bug this guards: the response used to hardcode "untriaged", so an
    // entry restored to the archive was reported as back in the inbox.
    mutation.mockResolvedValue("kept");
    const result = await dispatchTool("lc_undo_discard", { entry_id: "abc" }, USER);
    expect(JSON.parse(result.content[0].text).status).toBe("kept");
  });
});
