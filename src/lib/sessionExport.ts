import type { ChatMessage, SuggestionBatch, TranscriptChunk } from "@/types";

export interface SessionExportPayload {
  exportedAt: string;
  transcript: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
}

export function buildSessionExport(payload: SessionExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function downloadTextFile(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
