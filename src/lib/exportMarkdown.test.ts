import { describe, expect, test } from "vitest";
import { buildExportMarkdown, exportFilename, type ExportEntry } from "./exportMarkdown";

const entry = (fields: Partial<ExportEntry>): ExportEntry => ({
  createdAt: Date.parse("2026-09-14T13:00:00Z"),
  captureMode: "text",
  status: "kept",
  promotedTo: null,
  transcript: "an idea",
  transcriptionStatus: "n/a",
  ...fields,
});

describe("exportFilename", () => {
  test("uses the local date, zero-padded", () => {
    expect(exportFilename(new Date(2026, 8, 4, 23, 30))).toBe("loose-change-2026-09-04.md");
  });
});

describe("buildExportMarkdown", () => {
  const exportedAt = new Date("2026-09-17T12:00:00Z");

  test("one section per entry with mode, status label and transcript", () => {
    const md = buildExportMarkdown([entry({}), entry({ captureMode: "voice", status: "untriaged" })], exportedAt);
    expect(md).toContain("2 captures");
    expect(md.match(/^## /gm)).toHaveLength(2);
    expect(md).toContain("- **Captured:** Typed");
    expect(md).toContain("- **Status:** Kept");
    expect(md).toContain("- **Captured:** Voice");
    expect(md).toContain("- **Status:** Inbox");
    expect(md).toContain("an idea");
    expect(md).not.toContain("untriaged");
  });

  test("a sent entry names where it went", () => {
    const md = buildExportMarkdown([entry({ status: "promoted", promotedTo: "controlledchaos" })], exportedAt);
    expect(md).toContain("- **Status:** Sent to ControlledChaos");
  });

  test("an untranscribed memo says so instead of printing null", () => {
    const md = buildExportMarkdown(
      [entry({ captureMode: "voice", transcript: null, transcriptionStatus: "failed" })],
      exportedAt,
    );
    expect(md).toContain("couldn't be transcribed");
    expect(md).not.toContain("null");
  });

  test("an edited transcript keeps its original, quoted line by line", () => {
    const md = buildExportMarkdown([entry({ transcript: "fixed", originalTranscript: "line one\nline two" })], exportedAt);
    expect(md).toContain("- **Edited:** yes");
    expect(md).toContain("> line one\n> line two");
  });

  test("an empty export is still a valid file", () => {
    const md = buildExportMarkdown([], exportedAt);
    expect(md).toContain("0 captures");
    expect(md).not.toContain("## ");
  });
});
