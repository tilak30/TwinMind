# TwinMind Technical Architecture

This document explains the complete runtime flow, component responsibilities, and operational edge cases for TwinMind.

## 1. System Overview

TwinMind is a client-heavy Next.js app with a thin same-origin API proxy layer:

- Browser captures microphone audio in 30 second segments.
- Each segment is transcribed through Groq Whisper via `/api/groq/transcribe`.
- Transcript updates trigger suggestion generation through Groq chat via `/api/groq/chat`.
- Suggestion cards can be expanded into detailed chat responses.
- App state is session-memory only via Zustand unless user exports JSON.

## 2. Main Runtime Flow

### 2.1 Boot and configuration

1. `src/app/page.tsx` renders `AppShell`.
2. `SettingsModal` writes user settings to Zustand:
   - `groqApiKey`
   - prompt templates (`liveSuggestionPrompt`, `expandedAnswerPrompt`, `chatPrompt`)
   - `contextWindowLines`
3. No persistence is used by default, so settings and session data reset on tab refresh.

### 2.2 Audio capture and transcription

1. `TranscriptColumn` starts/stops recording via `useMeetingRecorder`.
2. `useMeetingRecorder`:
   - captures mic stream with `getUserMedia`
   - records one full segment per cycle (`start` -> collect chunks -> `stop`)
   - rebuilds a complete `Blob` per segment for Whisper compatibility
3. Segment blobs are enqueued and processed serially.
4. `transcribeAudioChunk` posts multipart form data to `/api/groq/transcribe`.
5. `src/app/api/groq/transcribe/route.ts` forwards the request to Groq Whisper.
6. Returned transcript text is appended to store as `TranscriptChunk`.

### 2.3 Live suggestion generation

Suggestions are generated from only two trigger paths:

1. **Transcript trigger** (`"transcript"`): after a 30s segment is transcribed and appended.
2. **Manual trigger** (`"manual"`): when user asks for suggestions now.

Manual trigger behavior while recording:

- The app first flushes the currently open recording segment.
- That partial segment is transcribed and appended to transcript.
- Then one manual suggestion refresh runs.
- The flushed segment does not fire a second transcript-triggered suggestion call.

Context behavior:

- Both transcript and manual trigger use the same `contextWindowLines` setting.
- Manual trigger does not override context size.

Technical steps:

1. Suggestion requests are serialized with `suggestionChain` to avoid overlap.
2. Engine builds a recent transcript snippet via `buildTranscriptSnippet`.
3. Prompt injection replaces `{TRANSCRIPT_SNIPPET}` in the live suggestion template.
4. `groqChatCompletion` calls `/api/groq/chat` with:
   - low temperature
   - token budget
   - `response_format: json_object` when supported
5. Response is parsed by `parseSuggestionCards` and normalized to exactly 3 cards.
6. Batch is prepended to `suggestionBatches`.

### 2.4 Chat flows

Two chat entry points use full transcript context:

- Direct user question: `sendDirectChatMessage`
- Card expansion: `expandSuggestionToChat`

Both:

1. append user message to chat stream
2. inject transcript into prompt template
3. call `groqChatCompletion`
4. append assistant reply

### 2.5 Export

`TranscriptColumn` export button serializes:

- transcript lines
- all suggestion batches
- all chat messages
- export timestamp

using `buildSessionExport`, then downloads as JSON.

## 3. Component Responsibilities

- `src/store/useTwinMindStore.ts`: canonical state and state mutators
- `src/hooks/useMeetingRecorder.ts`: mic lifecycle, segmentation, STT queueing
- `src/services/suggestionEngine.ts`: serialized suggestion orchestration
- `src/services/chatActions.ts`: direct chat and expansion actions
- `src/lib/groqClient.ts`: API wrapper, retries, fallback model logic
- `src/lib/suggestionParser.ts`: robust JSON extraction and normalization
- `src/app/api/groq/*`: server-side proxy routes to Groq APIs

## 4. Error Handling Strategy

- A single session-level banner (`sessionError`) communicates failures.
- Client wrappers parse upstream JSON/text errors and trim noisy payloads.
- Suggestions include model output preview when parsing fails for debugability.
- Recorder and API-key guards fail early with explicit user-facing messages.

## 5. Known Loopholes and Side Cases

### 5.1 Security and key handling

- API key is user-managed in browser memory and sent to app routes.
- This avoids CORS issues but does not provide server-side key secrecy.

### 5.2 State growth and performance

- `transcript`, `suggestionBatches`, and `chatMessages` are unbounded.
- Long sessions can increase memory use and render cost.

### 5.3 In-flight staleness

- Suggestion/chat requests use a snapshot of state at request time.
- New transcript can arrive before response returns, creating stale outputs.

### 5.4 Request lifecycle gaps

- No cancellation token support for long-running STT/chat/suggestion requests.
- Stop action halts capture but not already in-flight network calls.

### 5.5 Prompt-template fragility

- If required placeholders are removed in Settings, grounding quality degrades.
- There is currently no template validator enforcing placeholder presence.

### 5.6 Error visibility model

- One shared `sessionError` means newer errors overwrite previous context.

## 6. Recommended Hardening Priorities

1. Add bounded retention windows for transcript, batches, and chat.
2. Add AbortController support and stale-response guards.
3. Validate prompt templates for required placeholders.
4. Introduce optional session persistence toggle.
5. Add telemetry hooks for STT and suggestion latency/failure rates.

## 7. Operational Notes

- Prefer HTTPS production deployment for microphone and transport safety.
- Keep proxy routes on Node runtime for stable file forwarding behavior.
- Structured JSON mode for suggestions improves parser reliability but still requires fallback handling.
