import { DEFAULT_GROQ_CHAT_MODEL, DEFAULT_WHISPER_MODEL } from "@/lib/defaults";

const FALLBACK_CHAT_MODEL = "meta-llama/llama-3.3-70b-versatile";

type ChatRole = "system" | "user" | "assistant";

export interface GroqChatMessage {
  role: ChatRole;
  content: string;
}

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
    fd.append("mimeType", audio.type);
  }

  const res = await fetch("/api/groq/transcribe", { method: "POST", body: fd });
  const data = (await parseJsonResponse(res)) as { text?: string };
  const text = data.text?.trim() ?? "";
  return text;
}

function extractAssistantText(data: unknown): string {
  const root = data as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = root.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

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
    if (primaryModel === FALLBACK_CHAT_MODEL) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const retriable =
      message.includes("model") || message.includes("does not exist") || message.includes("404");
    if (!retriable) throw err;
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
