import type { SuggestionCard, SuggestionType } from "@/types";

const ALLOWED: SuggestionType[] = [
  "fact_check",
  "question",
  "answer",
  "talking_point",
  "clarify",
];

function coerceType(value: unknown): SuggestionType {
  if (typeof value === "string" && (ALLOWED as string[]).includes(value)) {
    return value as SuggestionType;
  }
  return "talking_point";
}

/** Strip common markdown fences (handles multiple layers). */
function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  for (let pass = 0; pass < 6; pass++) {
    const stripped = s
      .replace(/^```(?:json|JSON)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();
    if (stripped === s) break;
    s = stripped;
  }
  return s;
}

/** Replace curly/smart quotes that break JSON.parse */
function normalizeJsonQuotes(s: string): string {
  return s
    .replace(/\uFEFF/g, "")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

/**
 * Extract the first top-level JSON object using brace depth, respecting strings.
 */
function extractBalancedJsonObject(source: string): string | null {
  const start = source.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < source.length; i++) {
    const c = source[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extract the first top-level JSON array using bracket depth, respecting strings.
 */
function extractBalancedJsonArray(source: string): string | null {
  const start = source.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < source.length; i++) {
    const c = source[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

/** Best-effort fixes for models that emit almost-valid JSON */
function tryParseLenient(slice: string): unknown {
  const normalized = normalizeJsonQuotes(slice);
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    const noTrail = normalized.replace(/,(?=\s*[\]\}])/g, "");
    return JSON.parse(noTrail) as unknown;
  }
}

function rowsFromParsed(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj && Array.isArray(obj.suggestions)) {
    return obj.suggestions;
  }
  if (obj && Array.isArray(obj.items)) {
    return obj.items;
  }
  throw new Error("Model output was not a JSON array or object with suggestions[]");
}

export function parseSuggestionCards(raw: string): SuggestionCard[] {
  const cleaned = stripMarkdownFences(raw);

  let parsed: unknown;
  try {
    parsed = tryParseLenient(cleaned);
  } catch {
    const objSlice = extractBalancedJsonObject(cleaned) ?? extractBalancedJsonObject(raw);
    const arrSlice = extractBalancedJsonArray(cleaned) ?? extractBalancedJsonArray(raw);
    if (objSlice) {
      try {
        parsed = tryParseLenient(objSlice);
      } catch {
        parsed = undefined;
      }
    }
    if (!parsed && arrSlice) {
      parsed = tryParseLenient(arrSlice);
    }
    if (!parsed) {
      throw new Error("Model output was not valid JSON");
    }
  }

  let rows: unknown[];
  try {
    rows = rowsFromParsed(parsed);
  } catch {
    throw new Error("Could not find suggestions array in JSON");
  }

  const cards: SuggestionCard[] = rows.map((item) => {
    const obj = item as Record<string, unknown>;
    return {
      id: crypto.randomUUID(),
      type: coerceType(obj.type),
      preview_text: String(obj.preview_text ?? "").slice(0, 120),
      hidden_context: String(obj.hidden_context ?? "").slice(0, 320),
    };
  });

  if (cards.length < 3) {
    throw new Error(`Expected 3 suggestions, got ${cards.length}`);
  }

  return cards.slice(0, 3);
}
