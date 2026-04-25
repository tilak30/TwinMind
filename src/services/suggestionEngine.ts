/**
 * suggestionEngine.ts
 *
 * Orchestrates live suggestion generation. Two entry points exist:
 *
 *   - "transcript" trigger: called automatically after each 30-second Whisper
 *     segment is transcribed. Uses the current in-store transcript as-is.
 *
 *   - "manual" trigger: called when the user clicks "Reload suggestions".
 *     Flushes the currently open recorder segment first so the latest speech
 *     is captured and transcribed before generating suggestions.
 *
 * Requests are serialised via a promise chain (suggestionChain) so that
 * back-to-back triggers never produce overlapping LLM calls or race conditions
 * on the suggestion batch list.
 */

import { groqChatCompletion } from "@/lib/groqClient";
import { parseSuggestionCards } from "@/lib/suggestionParser";
import { buildTranscriptSnippet } from "@/lib/transcriptFormat";
import type { SuggestionBatch } from "@/types";
import { useTwinMindStore } from "@/store/useTwinMindStore";

// ─── Serialisation chain ────────────────────────────────────────────────────────

/**
 * Module-level promise chain. All suggestion tasks are appended here so only
 * one LLM call runs at a time — prevents duplicate or overlapping batches.
 */
let suggestionChain: Promise<void> = Promise.resolve();

/**
 * Appends a suggestion task to the serial chain and swallows errors so a
 * failing task does not block future tasks in the queue.
 *
 * @param task - Async function to enqueue.
 */
function enqueueSuggestions(task: () => Promise<void>): Promise<void> {
  suggestionChain = suggestionChain.then(task).catch(() => undefined);
  return suggestionChain;
}

// ─── Prompt constants ───────────────────────────────────────────────────────────

/**
 * System prompt enforcing strict JSON output for the suggestion model call.
 * Using response_format: json_object + a tight system prompt dramatically
 * reduces parse failures.
 *
 * Three type values MUST be distinct per batch to ensure variety.
 */
const SUGGESTION_SYSTEM = `You return ONE JSON object only (no markdown, no prose).
The object MUST have key "suggestions" whose value is an array of EXACTLY 3 items.
Each item MUST have keys: type, preview_text, hidden_context — all strings.
type must be one of: fact_check, question, answer, talking_point, clarify.
The three type values MUST all be different from each other.`;

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Produces a stable string key for a suggestion batch based on its content.
 * Used to detect duplicate batches so an identical refresh does not prepend
 * a visually identical batch to the list.
 *
 * @param batch - The suggestion batch to fingerprint.
 */
function normalizedSuggestionKey(batch: SuggestionBatch): string {
  return batch.suggestions
    .map((s) => `${s.type}|${s.preview_text.trim().toLowerCase()}|${s.hidden_context.trim().toLowerCase()}`)
    .join("||");
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Schedules a suggestion refresh and returns a promise that resolves when
 * the queued task completes (or is skipped due to missing API key / guard).
 *
 * Trigger semantics:
 *   - "transcript": no recorder flush; uses whatever transcript is in store.
 *     Called by useMeetingRecorder after each Whisper segment AND by the
 *     30-second auto-refresh timer in SuggestionsColumn.
 *   - "manual": flushes the open recorder segment first so the very latest
 *     speech is included. Called when the user clicks "Reload suggestions".
 *
 * Error handling:
 *   - Sets sessionError with a trimmed model output preview on parse failures
 *     to aid prompt debugging without exposing a blank error.
 *
 * @param reason - Why the refresh was requested ("transcript" | "manual").
 */
export function scheduleSuggestionRefresh(reason: "transcript" | "manual"): Promise<void> {
  return enqueueSuggestions(async () => {
    const state = useTwinMindStore.getState();
    const apiKey = state.groqApiKey.trim();

    if (!apiKey) {
      useTwinMindStore.setState({ sessionError: "Add your Groq API key in Settings to generate suggestions." });
      return;
    }

    useTwinMindStore.setState({ suggestionsBusy: true, sessionError: null });
    let rawModelText = "";

    try {
      // Manual trigger: flush the currently open recorder segment so the user
      // gets suggestions that include what they just said.
      if (reason === "manual") {
        const beforeFlush = useTwinMindStore.getState();
        if (beforeFlush.recordingActive && beforeFlush.flushRecorderSegment) {
          await beforeFlush.flushRecorderSegment();
        }
      }

      // Build a sliding-window snippet from recent transcript lines.
      const latest = useTwinMindStore.getState();
      const snippet = buildTranscriptSnippet(latest.transcript, latest.contextWindowLines);
      const prompt = latest.liveSuggestionPrompt.replaceAll("{TRANSCRIPT_SNIPPET}", snippet);

      rawModelText = await groqChatCompletion(
        apiKey,
        [
          { role: "system", content: SUGGESTION_SYSTEM },
          { role: "user", content: prompt },
        ],
        {
          temperature: 0.1,           // Low temp for deterministic, grounded output.
          max_tokens: 2048,
          response_format: { type: "json_object" },
        },
      );

      const suggestions = parseSuggestionCards(rawModelText);

      const batch: SuggestionBatch = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        suggestions,
        trigger: reason,
      };

      // Dedup: skip prepend if the new batch is identical to the current latest.
      const current = useTwinMindStore.getState();
      const latestBatch = current.suggestionBatches[0];
      if (!latestBatch || normalizedSuggestionKey(latestBatch) !== normalizedSuggestionKey(batch)) {
        current.prependSuggestionBatch(batch);
      }
    } catch (e) {
      // Include a trimmed model output preview in the error to aid debugging.
      const base = e instanceof Error ? e.message : "Suggestion refresh failed";
      const preview = rawModelText
        ? ` Model output (trimmed): ${rawModelText.replace(/\s+/g, " ").slice(0, 200)}${rawModelText.length > 200 ? "…" : ""}`
        : "";
      useTwinMindStore.setState({ sessionError: `${base}.${preview}` });
    } finally {
      useTwinMindStore.setState({ suggestionsBusy: false });
    }
  });
}
