# Suggestion and Summary Evaluation Report

This report documents a full validation pass focused on:

- live suggestions quality
- expanded summary quality
- direct chat summary quality
- reliability and formatting behavior

## 1) What I did

### A. Code/runtime validation

Ran project validation commands:

- `npm run lint`
- `npm run build`

Result:

- lint passed with no errors
- production build passed
- app routes compiled correctly (`/api/groq/chat`, `/api/groq/transcribe`)

### B. Live model-output testing

Used a real Groq key and ran live calls against Groq chat completions to test output quality and format behavior.

Important:

- tests used the same model family as app default (`openai/gpt-oss-120b`)
- test prompts matched app intent (suggestion JSON, expansion brief, chat answer)
- suggestions test used `response_format: { type: "json_object" }`

Two transcript scenarios were evaluated:

1. **Structured/clear meeting transcript** (launch delay, blockers, SOC2, CTO constraint)
2. **Ambiguous transcript** (uncertain legal/docs/pricing context)

## 2) How I tested

### Test 1: Suggestions + Expansion + Chat (structured transcript)

Goal:

- confirm suggestions are grounded and diverse
- check expansion follows required section format
- check chat remains plain text and grounded

Observed outputs:

- Suggestions returned valid JSON object with exactly 3 items.
- Suggestion `type` values were distinct (`question`, `answer`, `talking_point`).
- Content was grounded in transcript details.
- Expansion quality was conceptually strong, but output formatting drifted from strict app requirements.
- Chat response was useful but used markdown formatting even though prompt says plain text.

### Test 2: Suggestions on ambiguous transcript

Goal:

- verify behavior when transcript evidence is weak or vague
- check if uncertainty is surfaced

Observed outputs:

- Suggestions stayed reasonably grounded.
- Included one `clarify` card and explicit uncertainty text in `hidden_context`.
- JSON format remained valid and parseable.

## 3) Results summary

## 3.1 Suggestions quality

Strengths:

- good grounding on factual items
- good type diversity
- good relevance in both clear and ambiguous contexts

Weaknesses:

- uncertainty handling was inconsistent (some cards had empty `hidden_context` when ambiguity existed)
- no explicit confidence score (hard to rank reliability)

## 3.2 Expanded summary quality

Strengths:

- captured major risks and actions
- correctly reflected transcript constraints

Weaknesses:

- did not strictly follow required plain-text structure
- included markdown-like formatting (`**`, numbered lists)
- `Say this` section header appeared, but actual one-line content was missing in one live output

## 3.3 Direct chat quality

Strengths:

- useful and actionable answer
- grounded in transcript details

Weaknesses:

- markdown leakage despite explicit plain-text instruction
- sometimes verbose beyond "quick in-meeting" style

## 4) Key issues found

1. **Format control is not strict enough for chat/expansion**
   - model still emits markdown and style drift
2. **Section contract occasionally breaks**
   - `Say this` line can be omitted or malformed
3. **Ambiguity signaling could be stronger**
   - hidden uncertainty not consistently present when evidence is weak
4. **No automated quality gate after generation**
   - app trusts model output text for chat/expansion without normalization step

## 5) Improvements (high impact first)

## 5.1 Prompt engineering improvements

### A. Add hard output grammar for chat/expansion

For both chat and expansion prompts:

- require exact section headers in uppercase
- require no markdown tokens (`**`, `#`, backticks, numbered lists)
- require `Say this:` to be exactly one sentence on one line

Example constraint block:

- "Return plain text only."
- "Do not use `**`, `#`, `_`, backticks, numbered lists, or markdown bullets."
- "Use only `- ` for bullets."
- "Include every required section exactly once."
- "`Say this:` must contain exactly one sentence."

### B. Add transcript citation hints

Require each "FROM THE CALL" bullet to include short evidence reference pattern, for example:

- `[from call] ...`

This improves faithfulness and reviewer trust.

### C. Strengthen ambiguity behavior

Add rule:

- "If confidence is low, include at least one explicit unknown in `GAPS / UNKNOWN` and one clarifying question."

### D. Keep suggestion cards concise with stronger truncation intent

Even though parser truncates lengths, add explicit style guard:

- "Prefer one clear sentence, <= 18 words for preview_text."

## 5.2 Non-prompt improvements (recommended)

### A. Add output normalizer for chat/expansion

Post-process model text before showing in UI:

- strip markdown markers
- enforce required section order
- if `Say this:` missing, auto-generate fallback from summary intent

### B. Add lightweight validator + retry

For expansion/chat:

- validate section presence and plain-text compliance
- if invalid, run one repair pass with a small "format fixer" prompt

### C. Add quality telemetry

Track counters:

- markdown leakage rate
- missing section rate
- missing `Say this` rate
- suggestion parse-repair rate

This makes tuning measurable instead of subjective.

### D. Add confidence metadata for suggestions

Internally compute or request:

- confidence: `high|medium|low`

Use it for ranking or warning badges later (UI optional).

## 6) Recommended implementation plan

Phase 1 (fast wins):

1. tighten chat + expansion prompts
2. add post-processing to strip markdown and enforce `Say this`
3. add one retry/repair pass for malformed outputs

Phase 2 (quality scaling):

1. ambiguity and confidence policies
2. telemetry collection
3. regression evaluation set with 10-20 fixed transcript scenarios

## 7) Practical conclusion

- Suggestion generation is in good shape for grounding and parseability.
- Main quality risk is formatting and structure drift in expansion/chat outputs.
- Best improvement path is a **prompt + validator + repair** combination.
- This gives better consistency than prompt-only tuning and keeps real-time latency manageable.

## 8) Implemented changes (now applied)

The following Phase 1 changes are now implemented in code:

1. **Stronger prompt constraints** in `src/lib/defaults.ts`
   - explicit ban on markdown markers and numbered lists
   - strict section-order requirements for chat and expansion
   - strict one-line, one-sentence `Say this:` requirement for expansion

2. **Runtime response normalization** in `src/services/chatActions.ts`
   - markdown stripping for chat/expansion output
   - numbered-list to `- ` bullet conversion
   - section enforcement for chat (`SUMMARY`, `FROM THE CALL`, `IF UNCLEAR`, `OPTIONAL NEXT STEP`)
   - section enforcement for expansion (`SUMMARY`, `WHAT THE TRANSCRIPT SHOWS`, `GAPS / UNKNOWN`, `NEXT MOVE`, `RISKS`)
   - guaranteed `Say this:` line with fallback when missing
