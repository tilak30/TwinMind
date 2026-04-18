export type SuggestionType =
  | "fact_check"
  | "question"
  | "answer"
  | "talking_point"
  | "clarify";

export interface TranscriptChunk {
  id: string;
  text: string;
  createdAt: string;
}

export interface SuggestionCard {
  id: string;
  type: SuggestionType;
  preview_text: string;
  hidden_context: string;
}

export interface SuggestionBatch {
  id: string;
  createdAt: string;
  suggestions: SuggestionCard[];
  /** Why this batch was generated */
  trigger?: "transcript" | "manual";
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** Present when the message originated from a suggestion click */
  sourceSuggestionId?: string;
  /** e.g. FACT-CHECK when user expanded a suggestion card */
  userTag?: string;
}
