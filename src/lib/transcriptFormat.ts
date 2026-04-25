/**
 * transcriptFormat.ts
 *
 * Utility functions for formatting the transcript array into strings
 * suitable for LLM prompt injection.
 *
 *   - formatFullTranscript:  full chronological transcript with ISO timestamps.
 *     Used by chat and expansion prompts that need complete meeting context.
 *
 *   - buildTranscriptSnippet: sliding window of the N most recent lines.
 *     Used by the suggestion prompt to keep context focused and token-efficient.
 */

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
