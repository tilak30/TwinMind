/**
 * useTwinMindStore.ts
 *
 * Central Zustand store — the single source of truth for all runtime state.
 * State is kept entirely in memory; there is no persistence between page reloads
 * by design (no login, no data persistence per spec).
 *
 * Key state slices:
 *   - settings:         groqApiKey, prompt templates, contextWindowLines
 *   - transcript:       chronological TranscriptChunk array
 *   - suggestionBatches: newest-first SuggestionBatch array
 *   - chatMessages:     flat append-only ChatMessage array
 *   - busy flags:       suggestionsBusy, chatBusy, recordingActive
 *   - flushRecorderSegment: callback registered by useMeetingRecorder so the
 *                       suggestion engine can flush the open audio segment before
 *                       a manual reload without creating a circular dependency.
 */

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
  /** Last N transcript lines sent as context to the live suggestion LLM (0 = all lines) */
  contextWindowLines: number;
  /** Last N transcript lines sent as context to the expansion/chat LLM (0 = full transcript) */
  contextWindowLinesExpansion: number;
}

interface TwinMindState extends TwinMindSettings {
  settingsOpen: boolean;
  recordingActive: boolean;
  /** Recorder-provided callback used to flush in-progress audio before manual refresh. */
  flushRecorderSegment: null | (() => Promise<void>);
  transcript: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
  suggestionsBusy: boolean;
  chatBusy: boolean;
  sessionError: string | null;
  setSettingsOpen: (open: boolean) => void;
  setRecordingActive: (active: boolean) => void;
  setFlushRecorderSegment: (fn: null | (() => Promise<void>)) => void;
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
  /** 0 = use full transcript for expansion/chat (recommended: more context = better answers) */
  contextWindowLinesExpansion: 0,
});

export const useTwinMindStore = create<TwinMindState>((set) => ({
  ...defaultSettings(),
  settingsOpen: false,
  recordingActive: false,
  flushRecorderSegment: null,
  transcript: [],
  suggestionBatches: [],
  chatMessages: [],
  suggestionsBusy: false,
  chatBusy: false,
  sessionError: null,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setRecordingActive: (active) => set({ recordingActive: active }),
  setFlushRecorderSegment: (fn) => set({ flushRecorderSegment: fn }),
  patchSettings: (partial) => set((s) => ({ ...s, ...partial })),
  resetSettingsToDefaults: () =>
    set((s) => ({
      ...s,
      liveSuggestionPrompt: DEFAULT_LIVE_SUGGESTION_PROMPT,
      expandedAnswerPrompt: DEFAULT_EXPANDED_ANSWER_PROMPT,
      chatPrompt: DEFAULT_CHAT_PROMPT,
      contextWindowLines: DEFAULT_CONTEXT_WINDOW_LINES,
      contextWindowLinesExpansion: 0,
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
