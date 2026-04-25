/**
 * suggestionLabels.ts
 *
 * Pure display-layer helpers for suggestion card types.
 * Centralises all label text and colour decisions so the UI
 * never hard-codes them across multiple components.
 */

import type { SuggestionType } from "@/types";

/** Short label shown on suggestion cards (mockup-style). */
export function suggestionCardLabel(type: SuggestionType): string {
  switch (type) {
    case "question":
      return "QUESTION TO ASK";
    case "talking_point":
      return "TALKING POINT";
    case "fact_check":
      return "FACT-CHECK";
    case "answer":
      return "ANSWER";
    case "clarify":
      return "CLARIFY";
    default:
      return "SUGGESTION";
  }
}

/** Tailwind text color class for the category strip. */
export function suggestionTypeColorClass(type: SuggestionType): string {
  switch (type) {
    case "question":
      return "text-sky-400";
    case "talking_point":
      return "text-violet-400";
    case "fact_check":
      return "text-amber-300";
    case "answer":
      return "text-emerald-400";
    case "clarify":
      return "text-slate-400";
    default:
      return "text-slate-300";
  }
}

/** Sub-label on chat bubbles when expanding from a card. */
export function suggestionUserTag(type: SuggestionType): string {
  return suggestionCardLabel(type);
}
