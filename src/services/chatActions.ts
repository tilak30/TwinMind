/**
 * chatActions.ts
 *
 * Handles the two chat flows in TwinMind:
 *   1. sendDirectChatMessage  – user types a freeform question in the chat input.
 *   2. expandSuggestionToChat – user clicks a suggestion card in the middle column.
 *
 * Both flows:
 *   - Append a user message to the chat stream immediately (optimistic UI).
 *   - Build a prompt from the relevant template (chatPrompt / expandedAnswerPrompt).
 *   - Inject the full transcript as grounding context.
 *   - Call groqChatCompletion via the /api/groq/chat proxy.
 *   - Normalize the reply (strip markdown, guarantee "Say this:" on expansions).
 *   - Append the assistant reply to the chat stream.
 */

import { groqChatCompletion } from "@/lib/groqClient";
import { formatFullTranscript } from "@/lib/transcriptFormat";
import { suggestionUserTag } from "@/lib/suggestionLabels";
import type { SuggestionCard } from "@/types";
import { useTwinMindStore } from "@/store/useTwinMindStore";

// ─── System-level prompt constants ─────────────────────────────────────────────

/**
 * Plain-text formatting rules injected into both system prompts.
 * Prevents markdown leakage into the UI, which renders plain text only.
 */
const PLAIN_TEXT_RULES =
  "Formatting: plain text only for the in-app reader. Never use markdown (no **, *, _, #, backticks, or fenced code). Use hyphen bullets (- item).";

/**
 * System prompt for direct freeform chat questions.
 * Emphasises brevity (4–8 lines) and transcript faithfulness.
 */
const CHAT_SYSTEM = `You are TwinMind, a meeting copilot. ${PLAIN_TEXT_RULES}

Priorities:
1) Faithfulness to the transcript — if a detail is not supported by the transcript, say so clearly.
2) Practicality — what the user should think, check, or say next in the meeting.
3) Brevity first — 4–8 lines total, no padding.
4) Keep it skimmable: short bullets, no filler, no repetition.`;

/**
 * System prompt for suggestion card expansions.
 * Requires a "Say this:" closing line the user can speak verbatim.
 */
const EXPAND_SYSTEM = `You are TwinMind, expanding a live meeting card into a tight brief. ${PLAIN_TEXT_RULES}

Priorities:
1) Ground every factual claim about the meeting in the transcript; otherwise label it as general guidance.
2) Be concise: 4–8 lines total.
3) End with exactly one "Say this:" line the user can speak verbatim.
4) Keep each bullet to one short sentence.`;

// ─── Output normalisation helpers ──────────────────────────────────────────────

/**
 * Strips common markdown artefacts from model output so the plain-text UI
 * never renders raw markdown symbols.
 *
 * Handles: fenced code blocks, heading hashes, blockquotes, bold/italic
 * emphasis markers, numbered lists (converted to hyphens), and excess blank lines.
 */
function sanitizePlainText(raw: string): string {
  const noCodeFences = raw.replace(/```[\s\S]*?```/g, "");
  const noHashes = noCodeFences.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  const noBlockquote = noHashes.replace(/^\s*>\s?/gm, "");
  const noEmphasis = noBlockquote.replace(/\*\*|__|\\*|_/g, "");
  return noEmphasis
    .replace(/^\s*\d+\.\s+/gm, "- ")   // numbered list → hyphen bullet
    .replace(/^\s*[•–]\s+/gm, "- ")    // other bullet styles → hyphen
    .replace(/\n{3,}/g, "\n\n")         // collapse excess blank lines
    .trim();
}

/**
 * Ensures the expansion reply ends with a well-formed "Say this:" line.
 *
 * Priority order:
 *   1. Model already produced "Say this: <content>" — normalise and keep it.
 *   2. Model produced "Say this:" with no content — use the following line.
 *   3. No "Say this:" found at all — append a safe generic fallback.
 */
function ensureSayThisLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trimRight());
  const idx = lines.findIndex((l) => l.trim().toLowerCase().startsWith("say this:"));

  if (idx !== -1) {
    const content = lines[idx]
      .slice(lines[idx].toLowerCase().indexOf("say this:") + "say this:".length)
      .trim();

    if (content) {
      // Case 1: content present — normalise punctuation and clamp length.
      const s = `Say this: ${content.replace(/\.$/, "")}.`;
      lines[idx] = s.length <= 230 ? s : s.slice(0, 229) + "…";
      return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }

    // Case 2: "Say this:" line has no content — use the very next non-empty line.
    const next = lines.slice(idx + 1).find((l) => l.trim().length > 0);
    if (next) {
      const s2 = `Say this: ${next.replace(/^-\s*/, "").replace(/\.$/, "")}.`;
      lines[idx] = s2.length <= 230 ? s2 : s2.slice(0, 229) + "…";
      return lines
        .filter((_, lineIdx) => lineIdx !== idx + 1)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
  }

  // Case 3: no "Say this:" found — safe generic fallback.
  return `${text}\n\nSay this: Based on the call, here is the safest next step we can commit to now.`;
}

/**
 * Normalises a direct chat reply: strips markdown only.
 * No structural enforcement is applied — the model replies freely
 * within the 4–8 line budget set by CHAT_SYSTEM.
 */
function normalizeChatReply(raw: string): string {
  return sanitizePlainText(raw);
}

/**
 * Normalises a suggestion expansion reply: strips markdown and guarantees
 * the presence of a "Say this:" closing line.
 */
function normalizeExpansionReply(raw: string): string {
  const cleaned = sanitizePlainText(raw);
  return ensureSayThisLine(cleaned);
}

// ─── Public actions ─────────────────────────────────────────────────────────────

/**
 * Sends a freeform user question to the LLM using the full transcript as context.
 *
 * Flow:
 *   1. Validate API key.
 *   2. Append the user message to the chat stream immediately.
 *   3. Build the chat prompt (injects full transcript + user message).
 *   4. Call groqChatCompletion and append the normalised assistant reply.
 *
 * @param userMessage - Raw text typed by the user in the chat input.
 */
export async function sendDirectChatMessage(userMessage: string): Promise<void> {
  const trimmed = userMessage.trim();
  if (!trimmed) return;

  const initial = useTwinMindStore.getState();
  if (!initial.groqApiKey.trim()) {
    useTwinMindStore.setState({
      sessionError: "Add your Groq API key in Settings before chatting.",
    });
    return;
  }

  // Optimistic append — user sees their message instantly.
  initial.appendChatMessage({ role: "user", content: trimmed });
  useTwinMindStore.setState({ chatBusy: true, sessionError: null });

  try {
    const s = useTwinMindStore.getState();
    const full = formatFullTranscript(s.transcript);

    // Inject full transcript and user question into the prompt template.
    const prompt = s.chatPrompt
      .replaceAll("{FULL_TRANSCRIPT}", full)
      .replaceAll("{USER_MESSAGE}", trimmed);

    const reply = await groqChatCompletion(
      s.groqApiKey,
      [
        { role: "system", content: CHAT_SYSTEM },
        { role: "user", content: prompt },
      ],
      { temperature: 0.25, max_tokens: 750 },
    );

    useTwinMindStore
      .getState()
      .appendChatMessage({ role: "assistant", content: normalizeChatReply(reply) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat request failed";
    useTwinMindStore.setState({ sessionError: message });
  } finally {
    useTwinMindStore.setState({ chatBusy: false });
  }
}

/**
 * Expands a clicked suggestion card into a detailed chat answer.
 *
 * Differences from sendDirectChatMessage:
 *   - Uses EXPAND_SYSTEM prompt (requires "Say this:" line).
 *   - Injects card.preview_text and card.hidden_context into the prompt.
 *   - Attaches sourceSuggestionId and userTag to the user message for UI display.
 *   - Higher max_tokens budget (900 vs 750) for the richer expansion format.
 *
 * @param card - The suggestion card the user clicked.
 */
export async function expandSuggestionToChat(card: SuggestionCard): Promise<void> {
  const initial = useTwinMindStore.getState();
  if (!initial.groqApiKey.trim()) {
    useTwinMindStore.setState({
      sessionError: "Add your Groq API key in Settings before expanding a suggestion.",
    });
    return;
  }

  // Show the card's preview text as the user message, with its type tag.
  initial.appendChatMessage({
    role: "user",
    content: card.preview_text,
    sourceSuggestionId: card.id,
    userTag: suggestionUserTag(card.type),
  });
  useTwinMindStore.setState({ chatBusy: true, sessionError: null });

  try {
    const s = useTwinMindStore.getState();
    const full = formatFullTranscript(s.transcript);

    // Template placeholders: suggestion text, hidden analyst notes, full transcript.
    const prompt = s.expandedAnswerPrompt
      .replaceAll("{SUGGESTION_TEXT}", card.preview_text)
      .replaceAll("{HIDDEN_CONTEXT}", card.hidden_context)
      .replaceAll("{FULL_TRANSCRIPT}", full);

    const reply = await groqChatCompletion(
      s.groqApiKey,
      [
        { role: "system", content: EXPAND_SYSTEM },
        { role: "user", content: prompt },
      ],
      { temperature: 0.25, max_tokens: 900 },
    );

    useTwinMindStore
      .getState()
      .appendChatMessage({ role: "assistant", content: normalizeExpansionReply(reply) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Expansion failed";
    useTwinMindStore.setState({ sessionError: message });
  } finally {
    useTwinMindStore.setState({ chatBusy: false });
  }
}
