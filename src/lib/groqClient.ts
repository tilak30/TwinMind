/**
 * groqClient.ts
 *
 * Thin wrapper around the app's same-origin API proxy routes:
 *   - /api/groq/transcribe  (Whisper Large V3 STT)
 *   - /api/groq/chat        (GPT-OSS 120B chat completions)
 *
 * All network calls go through the proxy rather than directly to api.groq.com
 * to avoid CORS restrictions in the browser. The Groq API key is forwarded
 * per-request in the request body; it is never stored server-side.
 *
 * Fallback strategy for chat:
 *   If the primary model (GPT-OSS 120B) is unavailable or returns a 404/model
 *   error, the client automatically retries with llama-3.3-70b-versatile.
 *   If response_format: json_object is unsupported by the primary model,
 *   the call is retried without it before falling back.
 */

import { DEFAULT_GROQ_CHAT_MODEL, DEFAULT_WHISPER_MODEL } from "@/lib/defaults";

/** Fallback model used when the primary chat model is unavailable. */
const FALLBACK_CHAT_MODEL = "llama-3.3-70b-versatile";

type ChatRole = "system" | "user" | "assistant";

/** A single message in a Groq chat completion request. */
export interface GroqChatMessage {
  role: ChatRole;
  content: string;
}

// ─── Error parsing helpers ──────────────────────────────────────────────────────

/**
 * Extracts a human-readable error message from a Groq API error response body.
 * Handles nested `{ error: { message } }`, flat `{ message }`, and raw text.
 *
 * @param data   - Parsed JSON body (may be null / non-object).
 * @param rawBody - Raw response text as fallback.
 * @param status  - HTTP status code for the fallback message.
 */
function messageFromGroqPayload(data: unknown, rawBody: string, status: number): string {
  if (typeof data !== "object" || data === null) {
    return rawBody.trim().slice(0, 500) || `Request failed (${status})`;
  }

  const body = data as Record<string, unknown>;

  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }

  const err = body.error;
  if (typeof err === "string" && err.trim()) {
    return err;
  }
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const nested = err as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message;
    }
  }

  return rawBody.trim().slice(0, 500) || `Request failed (${status})`;
}

/**
 * Reads a fetch Response body as text, parses it as JSON, and throws a
 * descriptive Error on non-2xx responses or malformed JSON.
 *
 * @param res - The fetch Response to parse.
 * @returns The parsed JSON payload.
 * @throws Error with a human-readable message on failure.
 */
async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    if (!res.ok) {
      throw new Error(text.trim().slice(0, 500) || `Request failed (${res.status})`);
    }
    throw new Error("Invalid JSON from API");
  }
  if (!res.ok) {
    throw new Error(messageFromGroqPayload(data, text, res.status));
  }
  return data;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Transcribes an audio Blob using Groq Whisper via the /api/groq/transcribe proxy.
 *
 * The audio is sent as multipart/form-data. The MIME type hint is forwarded so
 * the proxy can correctly name the file (e.g. recording.webm vs recording.wav).
 *
 * @param apiKey - User's Groq API key.
 * @param audio  - Audio Blob recorded by useMeetingRecorder (typically WebM).
 * @param model  - Whisper model to use; defaults to whisper-large-v3.
 * @returns The transcribed text, trimmed. Returns an empty string if Whisper
 *          finds no speech in the segment.
 */
export async function transcribeAudioChunk(
  apiKey: string,
  audio: Blob,
  model: string = DEFAULT_WHISPER_MODEL,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", audio, "chunk.webm");
  fd.append("apiKey", apiKey);
  fd.append("model", model);
  if (audio.type) {
    fd.append("mimeType", audio.type);  // tells the proxy what extension to use
  }

  const res = await fetch("/api/groq/transcribe", { method: "POST", body: fd });
  const data = (await parseJsonResponse(res)) as { text?: string };
  return data.text?.trim() ?? "";
}

/**
 * Extracts the assistant reply text from a Groq chat completion response.
 *
 * @param data - Parsed JSON response from /api/groq/chat.
 */
function extractAssistantText(data: unknown): string {
  const root = data as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = root.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

/**
 * Sends a chat completion request to the Groq API via the /api/groq/chat proxy.
 *
 * Fallback strategy (tried in order):
 *   1. Primary model + response_format (if requested).
 *   2. Primary model without response_format (if format is unsupported).
 *   3. Fallback model + response_format (if primary is unavailable).
 *   4. Fallback model without response_format.
 *
 * @param apiKey   - User's Groq API key.
 * @param messages - Ordered message array (system → user → assistant …).
 * @param options  - Optional overrides: model, temperature, max_tokens, response_format.
 * @returns The assistant's reply as a plain string.
 * @throws Error if all retry attempts fail.
 */
export async function groqChatCompletion(
  apiKey: string,
  messages: GroqChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    /** When set, Groq/OpenAI-compatible APIs return parseable JSON object content. */
    response_format?: { type: "json_object" };
  },
): Promise<string> {
  const primaryModel = options?.model ?? DEFAULT_GROQ_CHAT_MODEL;

  /** Low-level POST to the proxy, optionally including response_format. */
  const call = async (model: string, withResponseFormat: boolean) => {
    const res = await fetch("/api/groq/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        model,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        ...(withResponseFormat && options?.response_format
          ? { response_format: options.response_format }
          : {}),
      }),
    });
    return parseJsonResponse(res);
  };

  /**
   * Attempt the primary model. If response_format is requested but fails with
   * a format-related error, retry without it (some models don't support it).
   */
  const runPrimary = async () => {
    if (options?.response_format) {
      try {
        const data = await call(primaryModel, true);
        return extractAssistantText(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const maybeFormatUnsupported =
          message.includes("response_format") ||
          message.includes("json_object") ||
          message.includes("structured") ||
          message.includes("400");
        if (!maybeFormatUnsupported) throw err;
        // Retry without the format parameter.
        const data = await call(primaryModel, false);
        return extractAssistantText(data);
      }
    }
    const data = await call(primaryModel, false);
    return extractAssistantText(data);
  };

  try {
    return await runPrimary();
  } catch (err) {
    // Do not retry if we are already on the fallback model.
    if (primaryModel === FALLBACK_CHAT_MODEL) throw err;

    const message = err instanceof Error ? err.message : String(err);
    const retriable =
      message.includes("model") || message.includes("does not exist") || message.includes("404");
    if (!retriable) throw err;

    // Try fallback model — with then without response_format.
    if (options?.response_format) {
      try {
        const data = await call(FALLBACK_CHAT_MODEL, true);
        return extractAssistantText(data);
      } catch {
        const data = await call(FALLBACK_CHAT_MODEL, false);
        return extractAssistantText(data);
      }
    }
    const data = await call(FALLBACK_CHAT_MODEL, false);
    return extractAssistantText(data);
  }
}
