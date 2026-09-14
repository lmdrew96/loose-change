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
    ["lc_retry_transcription", {}],
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
    await dispatchTool("lc_list_archive", { limit: 50000 }, USER);
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

// ── MCP ↔ UI parity ────────────────────────────────────────────────────────
//
// Every tool must be reachable from the app, and every UI action that touches
// durable state must be reachable from MCP. This table is the contract: adding
// a tool without naming where it lives in the UI fails here rather than
// quietly shipping a capability only Claude can use.
const UI_SURFACE: Record<string, string> = {
  lc_list_inbox: "InboxScreen — paginated untriaged list",
  lc_list_archive: "KeptScreen — Kept / Sent on / Discarded tabs",
  lc_get_entry: "EntryCard — tap to expand; KeptScreen ?entry= deep link",
  lc_search: "SearchScreen — query input + status filter chips",
  lc_keep: "TriageScreen Keep button, K key, swipe right; SearchScreen Keep",
  lc_discard: "TriageScreen Discard, D key, swipe left; KeptScreen + SearchScreen trash",
  lc_undo_discard: "TriageScreen undo toast; KeptScreen Restore; SearchScreen Restore",
  lc_mark_promoted: "TriageScreen destination buttons + More destinations disclosure",
  lc_retry_transcription: "EntryCard — expand a timed-out voice memo, Try transcribing again",
  lc_get_stats: "SettingsScreen — Your captures breakdown",
  lc_capture_text: "RecordScreen — text mode",
};

// Asymmetries that are deliberate, with the reason. Anything here is exempt
// from needing an lc_ tool; anything NOT here needs one.
const UI_ONLY: Record<string, string> = {
  "voice capture": "binary audio does not fit JSON-RPC; lc_capture_text is the analogue",
  "mcp token generate/regenerate": "bootstraps MCP access, so exposing it over MCP is circular",
  "push subscribe/unsubscribe": "per-device browser permission, meaningless server-side",
  "triage skip": "moves an ephemeral cursor, persists nothing",
};

describe("MCP ↔ UI parity", () => {
  test("every tool names where it is reachable in the UI", () => {
    const missing = TOOLS.filter((t) => !UI_SURFACE[t.name]).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  test("the UI surface table has no entries for tools that no longer exist", () => {
    const names = new Set<string>(TOOLS.map((t) => t.name));
    expect(Object.keys(UI_SURFACE).filter((n) => !names.has(n))).toEqual([]);
  });

  test("every deliberate UI-only capability carries a documented reason", () => {
    for (const [capability, reason] of Object.entries(UI_ONLY)) {
      expect(reason.length, `${capability} needs a reason`).toBeGreaterThan(20);
    }
  });

  test("lc_search accepts every status the UI can filter by", () => {
    const tool = TOOLS.find((t) => t.name === "lc_search")!;
    expect(tool.inputSchema.properties.status.enum).toEqual([
      "untriaged",
      "kept",
      "discarded",
      "promoted",
    ]);
  });

  test("lc_list_archive covers exactly the Archive screen's tabs", () => {
    const tool = TOOLS.find((t) => t.name === "lc_list_archive")!;
    expect(tool.inputSchema.properties.status.enum).toEqual(["kept", "promoted", "discarded"]);
  });
});
