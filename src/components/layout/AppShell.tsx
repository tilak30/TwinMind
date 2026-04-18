"use client";

import { SettingsModal } from "@/components/settings/SettingsModal";
import { useTwinMindStore } from "@/store/useTwinMindStore";
import { ChatColumn } from "./ChatColumn";
import { SuggestionsColumn } from "./SuggestionsColumn";
import { TranscriptColumn } from "./TranscriptColumn";

export function AppShell() {
  const sessionError = useTwinMindStore((s) => s.sessionError);
  const dismissSessionError = useTwinMindStore((s) => s.dismissSessionError);
  const setSettingsOpen = useTwinMindStore((s) => s.setSettingsOpen);

  return (
    <>
      <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-[#0b0f14] text-slate-100">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2 lg:px-4">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400/90">
              TwinMind — Live Suggestions
            </p>
            <p className="truncate text-xs text-slate-500">Web app · session-only · Groq</p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
          >
            Settings
          </button>
        </header>

        {sessionError ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-rose-500/30 bg-rose-950/50 px-3 py-2 text-xs text-rose-50 lg:px-4">
            <p className="min-w-0 flex-1 break-words">{sessionError}</p>
            <button
              type="button"
              onClick={dismissSessionError}
              className="shrink-0 rounded border border-rose-200/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-100 hover:bg-white/5"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-white/10 overflow-hidden lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <TranscriptColumn />
          <SuggestionsColumn />
          <ChatColumn />
        </div>
      </div>
      <SettingsModal />
    </>
  );
}
