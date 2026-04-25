# TwinMind — Live Suggestions

A production-style **Next.js (App Router)** web app that acts as an **always-on meeting copilot**: live microphone capture, **Groq Whisper** transcription in **~30 second segments**, **Groq LLM** “live suggestion” cards (three per batch), and a **session-only chat** for deeper answers. State lives in **memory** (Zustand); nothing is persisted to `localStorage` unless you export.

Technical architecture and runtime flow details: [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md)
Live output test report and improvement plan: [`docs/SUGGESTION_AND_SUMMARY_EVALUATION.md`](docs/SUGGESTION_AND_SUMMARY_EVALUATION.md)

---

## Features

| Area | What it does |
|------|----------------|
| **Column 1 — Mic & transcript** | Round **play/pause** control, **~30s** complete WebM segments (stop/restart recorder so each file is valid for STT), timestamps per line, **Export** JSON. |
| **Column 2 — Live suggestions** | Batches of **3** cards, **newest first**, older batches **dimmed**. **Color-coded** types (question, fact_check, answer, talking_point, clarify). Suggestions are generated from two paths only: after transcribed recording text, or manual refresh. Manual refresh flushes in-progress audio first so latest speech is included. |
| **Column 3 — Chat** | **YOU** / **ASSISTANT** labels; suggestion expansions show a **type tag** (e.g. FACT-CHECK). Plain-text replies (no markdown in UI). |
| **Settings** | Groq API key (memory only), editable prompts, context window (lines). **Reset prompts** keeps your key. |
| **API proxy** | Same-origin `/api/groq/*` routes forward to Groq (avoids browser CORS). |

---

## Tech stack

- **Framework:** Next.js 15, React 19, TypeScript  
- **Styling:** Tailwind CSS  
- **State:** Zustand  
- **Speech-to-text:** Groq **Whisper** (`whisper-large-v3`) via `POST /api/groq/transcribe`  
- **LLM:** Groq chat completions via `POST /api/groq/chat` — default `openai/gpt-oss-120b` with fallback to `meta-llama/llama-3.3-70b-versatile`  
- **Suggestions JSON:** `response_format: json_object` when supported; output shape `{"suggestions":[...]}` (see `src/lib/defaults.ts` + `src/lib/suggestionParser.ts`)

---

## Why `/api/groq/*` exists

Groq’s REST API is not meant to be called **directly from the browser** (CORS). The app keeps your key in **Zustand** and sends it with each request to **your** Next.js routes, which call Groq server-side. Use **HTTPS** in production.

---

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Settings** → paste **Groq API key** → **Start** the mic (allow browser microphone). Optionally **Reset prompts to defaults** after pulling updates so prompts match `src/lib/defaults.ts`.

```bash
npm run build
npm start
```

---

## Deploy (Vercel / Netlify)

1. Connect the Git repository.  
2. **Build command:** `npm run build`  
3. **Output:** Next.js default (`.next`).  
4. No server env var is **required** for the Groq key (user enters it in Settings). Optional: you could later add server-only keys and change the client to omit the key from requests.

---

## Project layout (high level)

```
src/
  app/
    api/groq/chat/route.ts       # Proxies chat completions
    api/groq/transcribe/route.ts # Proxies Whisper (buffers upload → Groq)
    globals.css
    layout.tsx
    page.tsx
  components/layout/             # AppShell + 3 columns + Settings modal
  hooks/useMeetingRecorder.ts    # 30s segments; queue → Whisper → transcript
  lib/defaults.ts                # Default prompts & model names
  lib/groqClient.ts              # fetch wrappers + error parsing
  lib/suggestionParser.ts        # JSON object/array parsing for suggestions
  lib/suggestionLabels.ts        # UI labels & colors for types
  lib/transcriptFormat.ts
  lib/sessionExport.ts
  services/suggestionEngine.ts   # Serialized suggestion refresh + Groq call
  services/chatActions.ts        # Direct chat + suggestion expansion
  store/useTwinMindStore.ts
  types/index.ts
```

---

## Prompt engineering (defaults)

All defaults live in **`src/lib/defaults.ts`** and are editable in **Settings**.

1. **Live suggestions** — Meeting analyst: **exactly three** items, **three different `type` values**, short `preview_text`, `hidden_context` for expansion. Output is a **single JSON object** with a `suggestions` array (works with Groq `json_object` mode). Strong **grounding** and **no invented meeting facts**.

2. **Expanded answer** — Triggered when a suggestion card is clicked. Sections like **SUMMARY**, **WHAT THE TRANSCRIPT SHOWS**, **GAPS**, **NEXT MOVE**, **RISKS**, **Say this:** — all **plain text**.

3. **Chat** — User questions about the meeting; same **faithfulness** rules and plain-text sections.

Runtime **system** strings for chat/expansion are in **`src/services/chatActions.ts`** (reinforces no markdown).
Chat/expansion replies are also normalized at runtime to remove markdown artifacts, enforce section headers, and guarantee a `Say this:` line for expansions.

---

## Context window, models, and latency rationale

- **Context window (lines)**: defaults to a *recent* slice of the transcript (configurable in Settings). This keeps latency low and relevance high, while still letting the user ask global questions in chat (which uses the full transcript).
- **Whisper chunking (~30s)**: chosen because it gives fast updates while keeping each segment “complete enough” for reliable STT and limiting request overhead.
- **Model choice**:
  - **STT**: `whisper-large-v3` for accuracy on noisy meetings.
  - **LLM**: defaults to `openai/gpt-oss-120b` (largest OSS option on Groq where available), with automatic fallback to `meta-llama/llama-3.3-70b-versatile`.
- **Structured JSON for suggestions**: suggestions requests use Groq/OpenAI-compatible **`response_format: json_object`** when supported to maximize reliability (no truncated / non-JSON responses). If the API rejects structured mode, the client retries once without it.
- **Why these choices help latency**:
  - Suggestions are generated from a **short excerpt** (context window) and a **small output** (3 cards).
  - Suggestion generation calls are **serialized** so the UI doesn’t freeze or race during rapid updates.

---

## Audio pipeline (important)

`MediaRecorder.start(timeslice)` produces **fragments** that are **not** always valid standalone WebM files for Whisper. This app uses **segmented recording**: each **~30s** window is `start()` → collect chunks → `stop()` → one **Blob** → transcribe. That avoids Groq **“valid media file”** errors on later segments.

If you manually refresh suggestions while recording, the app flushes the current open segment first, transcribes it, then generates suggestions once. This makes "Get suggestions now" include the latest spoken content.

---

## Export

**Export** downloads JSON: full transcript (with timestamps), all suggestion batches (including `trigger`: transcript vs manual), and chat messages (including `userTag` when present).

---

## Troubleshooting

- **STT: “could not process file — valid media file?”**  
  - **Cause**: `MediaRecorder.start(timeslice)` yields WebM continuation fragments that are not valid standalone uploads.  
  - **Fix in this app**: record in **~30s segments** by `start()` → buffer → `stop()` and upload **one complete Blob** per segment (`src/hooks/useMeetingRecorder.ts`).

- **Transcription updates once, then stops**  
  - **Cause**: later STT segments failed (invalid media), so no new transcript lines were appended.  
  - **Fix**: same segmented recorder; failures show as a banner instead of silently stalling.

- **Suggestions: “Model output was not valid JSON” / “Could not find JSON array”**  
  - **Cause**: model output truncated mid-JSON (too-small `max_tokens`) or returned prose/markdown.  
  - **Fix in this app**: structured output using **`response_format: json_object`** (when supported), larger token budget, and a parser that accepts either `{"suggestions":[...]}` or a raw array (`src/lib/suggestionParser.ts`).

- **Chat responses include markdown (`**bold**`, headings, etc.)**  
  - **Cause**: models default to markdown formatting.  
  - **Fix**: system + prompt constraints enforce **plain text** only (`src/services/chatActions.ts`, `src/lib/defaults.ts`).

- **CORS / browser fetch to Groq fails**  
  - **Cause**: Groq endpoints are not intended for direct browser calls.  
  - **Fix**: same-origin proxy routes (`src/app/api/groq/*`) forward requests server-side.

- **Cursor “not logged in”**  
  - **Cause**: Cursor IDE authentication/session issue, unrelated to the app runtime.  
  - **Fix**: log out/in inside Cursor or use terminal Git credentials.

---

## License

Private / assignment use unless you add a license file.
