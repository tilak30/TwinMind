"use client";

import { useEffect, useId, useRef } from "react";
import { useTwinMindStore } from "@/store/useTwinMindStore";

export function SettingsModal() {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const settingsOpen = useTwinMindStore((s) => s.settingsOpen);
  const setSettingsOpen = useTwinMindStore((s) => s.setSettingsOpen);
  const patchSettings = useTwinMindStore((s) => s.patchSettings);
  const resetSettingsToDefaults = useTwinMindStore((s) => s.resetSettingsToDefaults);

  const groqApiKey = useTwinMindStore((s) => s.groqApiKey);
  const liveSuggestionPrompt = useTwinMindStore((s) => s.liveSuggestionPrompt);
  const expandedAnswerPrompt = useTwinMindStore((s) => s.expandedAnswerPrompt);
  const chatPrompt = useTwinMindStore((s) => s.chatPrompt);
  const contextWindowLines = useTwinMindStore((s) => s.contextWindowLines);
  const contextWindowLinesExpansion = useTwinMindStore((s) => s.contextWindowLinesExpansion);

  useEffect(() => {
    if (!settingsOpen) return;
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="tm-scroll flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-surface-border bg-surface-raised p-6 shadow-2xl shadow-black/40"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-white">
              Settings
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Stored in memory only for this tab session. Nothing is written to disk.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/5"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">Groq API key</span>
            <input
              ref={firstFieldRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={groqApiKey}
              onChange={(e) => patchSettings({ groqApiKey: e.target.value })}
              placeholder="Paste your Groq API key"
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white outline-none ring-accent/40 placeholder:text-slate-500 focus:ring-2"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">Context window — live suggestions (lines)</span>
            <input
              type="number"
              min={5}
              max={500}
              value={contextWindowLines}
              onChange={(e) =>
                patchSettings({ contextWindowLines: Math.max(5, Number(e.target.value) || 5) })
              }
              className="w-32 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white outline-none ring-accent/40 focus:ring-2"
            />
            <span className="text-xs text-slate-500">
              Last N transcript lines fed to the suggestion LLM. Default: 48.
            </span>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">Context window — expanded answers &amp; chat (lines)</span>
            <input
              type="number"
              min={0}
              max={500}
              value={contextWindowLinesExpansion}
              onChange={(e) =>
                patchSettings({ contextWindowLinesExpansion: Math.max(0, Number(e.target.value) || 0) })
              }
              className="w-32 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white outline-none ring-accent/40 focus:ring-2"
            />
            <span className="text-xs text-slate-500">
              Last N transcript lines sent when expanding a card or chatting. 0 = full transcript (recommended).
            </span>
          </label>

          <PromptField
            label="Live suggestion prompt"
            value={liveSuggestionPrompt}
            onChange={(v) => patchSettings({ liveSuggestionPrompt: v })}
            hint='Use "{TRANSCRIPT_SNIPPET}" where the recent transcript should be injected.'
          />
          <PromptField
            label="Expanded answer prompt"
            value={expandedAnswerPrompt}
            onChange={(v) => patchSettings({ expandedAnswerPrompt: v })}
            hint='Placeholders: "{SUGGESTION_TEXT}", "{HIDDEN_CONTEXT}", "{FULL_TRANSCRIPT}".'
          />
          <PromptField
            label="Chat prompt"
            value={chatPrompt}
            onChange={(v) => patchSettings({ chatPrompt: v })}
            hint='Use "{FULL_TRANSCRIPT}" and "{USER_MESSAGE}".'
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-surface-border pt-4">
          <button
            type="button"
            onClick={resetSettingsToDefaults}
            className="rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-500/10"
          >
            Reset prompts to defaults
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-200">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        spellCheck={false}
        className="tm-scroll rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 outline-none ring-accent/40 focus:ring-2"
      />
      <span className="text-xs text-slate-500">{hint}</span>
    </label>
  );
}
