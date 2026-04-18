import type { TranscriptChunk } from "@/types";

export function formatFullTranscript(chunks: TranscriptChunk[]): string {
  if (!chunks.length) return "(empty transcript)";
  return chunks
    .map((c) => {
      const t = new Date(c.createdAt).toISOString();
      return `[${t}] ${c.text}`;
    })
    .join("\n");
}

export function buildTranscriptSnippet(chunks: TranscriptChunk[], lineCount: number): string {
  if (!chunks.length) return "(no transcript yet)";
  const n = Math.max(1, lineCount);
  const slice = chunks.slice(-n);
  return slice
    .map((c) => {
      const t = new Date(c.createdAt).toLocaleTimeString();
      return `[${t}] ${c.text}`;
    })
    .join("\n");
}
