import { create } from "zustand";
import type { ChatMessage, SuggestionBatch, TranscriptChunk } from "@/types";
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_CONTEXT_WINDOW_LINES,
  DEFAULT_EXPANDED_ANSWER_PROMPT,
  DEFAULT_LIVE_SUGGESTION_PROMPT,
} from "@/lib/defaults";

export interface TwinMindSettings {
  groqApiKey: string;
  liveSuggestionPrompt: string;
  expandedAnswerPrompt: string;
  chatPrompt: string;
  /** Last N transcript lines sent as context to the LLM */
  contextWindowLines: number;
}

interface TwinMindState extends TwinMindSettings {
  settingsOpen: boolean;
  transcript: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
  suggestionsBusy: boolean;
  chatBusy: boolean;
  sessionError: string | null;
  setSettingsOpen: (open: boolean) => void;
  patchSettings: (partial: Partial<TwinMindSettings>) => void;
  /** Resets prompt templates and context size; preserves API key */
  resetSettingsToDefaults: () => void;
  dismissSessionError: () => void;
  appendTranscriptChunk: (chunk: Omit<TranscriptChunk, "id"> & { id?: string }) => void;
  prependSuggestionBatch: (batch: SuggestionBatch) => void;
  appendChatMessage: (message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string }) => void;
  clearSession: () => void;
}

const defaultSettings = (): TwinMindSettings => ({
  groqApiKey: "",
  liveSuggestionPrompt: DEFAULT_LIVE_SUGGESTION_PROMPT,
  expandedAnswerPrompt: DEFAULT_EXPANDED_ANSWER_PROMPT,
  chatPrompt: DEFAULT_CHAT_PROMPT,
  contextWindowLines: DEFAULT_CONTEXT_WINDOW_LINES,
});

export const useTwinMindStore = create<TwinMindState>((set) => ({
  ...defaultSettings(),
  settingsOpen: false,
  transcript: [],
  suggestionBatches: [],
  chatMessages: [],
  suggestionsBusy: false,
  chatBusy: false,
  sessionError: null,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  patchSettings: (partial) => set((s) => ({ ...s, ...partial })),
  resetSettingsToDefaults: () =>
    set((s) => ({
      ...s,
      liveSuggestionPrompt: DEFAULT_LIVE_SUGGESTION_PROMPT,
      expandedAnswerPrompt: DEFAULT_EXPANDED_ANSWER_PROMPT,
      chatPrompt: DEFAULT_CHAT_PROMPT,
      contextWindowLines: DEFAULT_CONTEXT_WINDOW_LINES,
    })),
  dismissSessionError: () => set({ sessionError: null }),
  appendTranscriptChunk: (chunk) =>
    set((s) => ({
      transcript: [
        ...s.transcript,
        {
          id: chunk.id ?? crypto.randomUUID(),
          text: chunk.text,
          createdAt: chunk.createdAt,
        },
      ],
    })),
  prependSuggestionBatch: (batch) =>
    set((s) => ({
      suggestionBatches: [batch, ...s.suggestionBatches],
    })),
  appendChatMessage: (message) =>
    set((s) => ({
      chatMessages: [
        ...s.chatMessages,
        {
          id: message.id ?? crypto.randomUUID(),
          role: message.role,
          content: message.content,
          createdAt: new Date().toISOString(),
          sourceSuggestionId: message.sourceSuggestionId,
          userTag: message.userTag,
        },
      ],
    })),
  clearSession: () =>
    set((s) => ({
      transcript: [],
      suggestionBatches: [],
      chatMessages: [],
      sessionError: null,
      groqApiKey: s.groqApiKey,
    })),
}));
