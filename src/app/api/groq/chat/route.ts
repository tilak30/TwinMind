import { NextResponse } from "next/server";

const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";

export const runtime = "nodejs";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      apiKey?: string;
      model?: string;
      messages?: ChatMessage[];
      temperature?: number;
      max_tokens?: number;
      response_format?: { type: string };
    };

    const apiKey = body.apiKey?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing Groq API key" }, { status: 400 });
    }
    if (!body.model || !body.messages?.length) {
      return NextResponse.json({ error: "Missing model or messages" }, { status: 400 });
    }

    const upstream = await fetch(GROQ_CHAT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        temperature: body.temperature ?? 0.4,
        max_tokens: body.max_tokens ?? 1024,
        ...(body.response_format ? { response_format: body.response_format } : {}),
      }),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: text || upstream.statusText, status: upstream.status },
        { status: upstream.status },
      );
    }

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat completion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
