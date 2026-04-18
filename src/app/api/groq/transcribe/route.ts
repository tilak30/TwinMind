import { NextResponse } from "next/server";

const GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const incoming = await req.formData();
    const file = incoming.get("file");
    const apiKey = incoming.get("apiKey");
    const model = (incoming.get("model") as string | null) ?? "whisper-large-v3";

    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "Missing or empty audio file" }, { status: 400 });
    }
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "Missing Groq API key" }, { status: 400 });
    }

    /**
     * Re-materialize the upload as a fresh Blob/File before forwarding to Groq.
     * Some runtimes hand Request FormData parts that do not stream reliably through a second fetch(),
     * which surfaces as Groq 400 "invalid audio" / empty decode.
     */
    const bytes = await file.arrayBuffer();
    const mimeHintRaw = incoming.get("mimeType");
    const mimeHint =
      typeof mimeHintRaw === "string" && mimeHintRaw.trim() ? mimeHintRaw.trim() : "";
    const mime =
      file.type && file.type !== "application/octet-stream" ? file.type : mimeHint || "audio/webm";
    const audioBlob = new Blob([bytes], { type: mime });
    const ext = mime.includes("mp4") ? "m4a" : mime.includes("wav") ? "wav" : "webm";
    const filename = `recording.${ext}`;

    const outbound = new FormData();
    outbound.append("file", audioBlob, filename);
    outbound.append("model", model.trim());
    /** Omit explicit response_format — Groq defaults to JSON with `{ "text": "..." }`. */

    const upstream = await fetch(GROQ_TRANSCRIBE, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      body: outbound,
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      let message = text || upstream.statusText;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } | string };
        if (parsed && typeof parsed === "object" && parsed.error) {
          if (typeof parsed.error === "string") message = parsed.error;
          else if (typeof parsed.error.message === "string") message = parsed.error.message;
        }
      } catch {
        // keep raw body snippet
      }
      return NextResponse.json(
        { error: message, status: upstream.status },
        { status: upstream.status },
      );
    }

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
