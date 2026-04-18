import { groqChatCompletion } from "@/lib/groqClient";
import { parseSuggestionCards } from "@/lib/suggestionParser";
import { buildTranscriptSnippet } from "@/lib/transcriptFormat";
import type { SuggestionBatch } from "@/types";
import { useTwinMindStore } from "@/store/useTwinMindStore";

let suggestionChain: Promise<void> = Promise.resolve();

function enqueueSuggestions(task: () => Promise<void>): Promise<void> {
  suggestionChain = suggestionChain.then(task).catch(() => undefined);
  return suggestionChain;
}

const SUGGESTION_SYSTEM = `You return ONE JSON object only (no markdown, no prose).
The object MUST have key "suggestions" whose value is an array of EXACTLY 3 items.
Each item MUST have keys: type, preview_text, hidden_context — all strings.
type must be one of: fact_check, question, answer, talking_point, clarify.
The three type values MUST all be different from each other.`;

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
          temperature: 0.1,
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
      useTwinMindStore.getState().prependSuggestionBatch(batch);
    } catch (e) {
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
