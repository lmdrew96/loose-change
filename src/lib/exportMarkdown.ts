import type { Doc } from "../../convex/_generated/dataModel";
import { STATUS_LABELS, destinationLabel } from "./labels";

export type ExportEntry = Pick<
  Doc<"entries">,
  "createdAt" | "captureMode" | "status" | "promotedTo" | "transcript" | "transcriptionStatus" | "originalTranscript"
>;

const CAPTURE_MODE_LABELS: Record<ExportEntry["captureMode"], string> = {
  voice: "Voice",
  text: "Typed",
  chat: "From a chat (MCP)",
};

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const pad = (n: number) => String(n).padStart(2, "0");

/** loose-change-2026-09-14.md, using the local date. */
export function exportFilename(now: Date): string {
  return `loose-change-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
}

function transcriptOrNote(entry: ExportEntry): string {
  if (entry.transcript !== null) return entry.transcript;
  if (entry.transcriptionStatus === "failed") return "_(couldn't be transcribed)_";
  return "_(not transcribed yet)_";
}

function statusLine(entry: ExportEntry): string {
  if (entry.status === "promoted" && entry.promotedTo) return `Sent to ${destinationLabel(entry.promotedTo)}`;
  return STATUS_LABELS[entry.status];
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

/** One section per entry, newest first, in the order they're given. */
export function buildExportMarkdown(entries: ExportEntry[], exportedAt: Date): string {
  const count = entries.length === 1 ? "1 capture" : `${entries.length} captures`;
  const sections = entries.map((entry) => {
    const lines = [
      `## ${dateFormatter.format(entry.createdAt)}`,
      "",
      `- **Captured:** ${CAPTURE_MODE_LABELS[entry.captureMode]}`,
      `- **Status:** ${statusLine(entry)}`,
    ];
    if (entry.originalTranscript !== undefined) lines.push("- **Edited:** yes — original below");
    lines.push("", transcriptOrNote(entry));
    if (entry.originalTranscript !== undefined) {
      lines.push("", "Original transcript:", "", quote(entry.originalTranscript));
    }
    return lines.join("\n");
  });

  return [
    "# Loose Change export",
    "",
    `Exported ${dateFormatter.format(exportedAt)} · ${count} · transcripts only, no audio`,
    ...sections.flatMap((section) => ["", "---", "", section]),
    "",
  ].join("\n");
}
