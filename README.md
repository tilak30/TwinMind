# TwinMind — Live Suggestions

A production-style **Next.js (App Router)** web app that acts as an **always-on meeting copilot**: live microphone capture, **Groq Whisper** transcription in **~30 second segments**, **Groq LLM** “live suggestion” cards (three per batch), and a **session-only chat** for deeper answers. State lives in **memory** (Zustand); nothing is persisted to `localStorage` unless you export.

---

## Features

| Area | What it does |
|------|----------------|
| **Column 1 — Mic & transcript** | Round **play/pause** control, **~30s** complete WebM segments (stop/restart recorder so each file is valid for STT), timestamps per line, **Export** JSON. |
| **Column 2 — Live suggestions** | Batches of **3** cards, **newest first**, older batches **dimmed**. **Color-coded** types (question, fact_check, answer, talking_point, clarify). **Reload** + **30s auto-refresh** timer. |
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

---

## Audio pipeline (important)

`MediaRecorder.start(timeslice)` produces **fragments** that are **not** always valid standalone WebM files for Whisper. This app uses **segmented recording**: each **~30s** window is `start()` → collect chunks → `stop()` → one **Blob** → transcribe. That avoids Groq **“valid media file”** errors on later segments.

---

## Export

**Export** downloads JSON: full transcript (with timestamps), all suggestion batches (including `trigger`: transcript vs manual), and chat messages (including `userTag` when present).

---

## Git: init, commit, push

```bash
cd "/path/to/TwinMindAssignment"
git init
git add .
git commit -m "Initial commit: TwinMind Live Suggestions"
```

**Push to GitHub** (create an empty repo on GitHub first, then):

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Or with **GitHub CLI** (logged in): `gh repo create twinmind-live-suggestions --public --source=. --remote=origin --push`

---

## Troubleshooting

- **STT errors** — Ensure each segment is non-trivial; check Groq dashboard / key / quotas. Banner shows Groq error text when possible.  
- **Invalid JSON on suggestions** — Parser accepts `{"suggestions":[...]}` or a raw array; `max_tokens` is high enough to avoid truncation. Reset prompts if you edited them and broke the JSON contract.  
- **Cursor “not logged in”** — That is an **IDE authentication** issue (Cursor account), not this repo.

---

## License

Private / assignment use unless you add a license file.
