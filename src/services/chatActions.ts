import { groqChatCompletion } from "@/lib/groqClient";
import { formatFullTranscript } from "@/lib/transcriptFormat";
import { suggestionUserTag } from "@/lib/suggestionLabels";
import type { SuggestionCard } from "@/types";
import { useTwinMindStore } from "@/store/useTwinMindStore";

const PLAIN_TEXT_RULES =
  "Formatting: plain text only for the in-app reader. Never use markdown (no **, *, _, #, backticks, or fenced code). Use hyphen bullets (- item). Optional short section titles in ALL CAPS on their own line.";

const CHAT_SYSTEM = `You are TwinMind, a meeting copilot. ${PLAIN_TEXT_RULES}

Priorities:
1) Faithfulness to the transcript — if a detail is not supported by the transcript, say so clearly.
2) Practicality — what the user should think, check, or say next in the meeting.
3) Brevity first — expand only when it increases decision quality.`;

const EXPAND_SYSTEM = `You are TwinMind, expanding a live meeting card into a tight brief. ${PLAIN_TEXT_RULES}

Priorities:
1) Ground every factual claim about the meeting in the transcript; otherwise label it as general guidance.
2) Optimize for skim speed: short sections, crisp bullets, no filler.
3) End with exactly one "Say this:" line the user can speak verbatim.`;

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

  initial.appendChatMessage({ role: "user", content: trimmed });
  useTwinMindStore.setState({ chatBusy: true, sessionError: null });

  try {
    const s = useTwinMindStore.getState();
    const full = formatFullTranscript(s.transcript);
    const prompt = s.chatPrompt
      .replaceAll("{FULL_TRANSCRIPT}", full)
      .replaceAll("{USER_MESSAGE}", trimmed);
    const reply = await groqChatCompletion(
      s.groqApiKey,
      [
        { role: "system", content: CHAT_SYSTEM },
        { role: "user", content: prompt },
      ],
      { temperature: 0.35, max_tokens: 2200 },
    );
    useTwinMindStore.getState().appendChatMessage({ role: "assistant", content: reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat request failed";
    useTwinMindStore.setState({ sessionError: message });
  } finally {
    useTwinMindStore.setState({ chatBusy: false });
  }
}

export async function expandSuggestionToChat(card: SuggestionCard): Promise<void> {
  const initial = useTwinMindStore.getState();
  if (!initial.groqApiKey.trim()) {
    useTwinMindStore.setState({
      sessionError: "Add your Groq API key in Settings before expanding a suggestion.",
    });
    return;
  }

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
      { temperature: 0.35, max_tokens: 2400 },
    );
    useTwinMindStore.getState().appendChatMessage({ role: "assistant", content: reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Expansion failed";
    useTwinMindStore.setState({ sessionError: message });
  } finally {
    useTwinMindStore.setState({ chatBusy: false });
  }
}
