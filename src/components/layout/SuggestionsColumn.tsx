"use client";

import { useEffect, useState } from "react";
import { suggestionCardLabel, suggestionTypeColorClass } from "@/lib/suggestionLabels";
import { expandSuggestionToChat } from "@/services/chatActions";
import { scheduleSuggestionRefresh } from "@/services/suggestionEngine";
import { useTwinMindStore } from "@/store/useTwinMindStore";

const AUTO_REFRESH_SECONDS = 30;

export function SuggestionsColumn() {
  const batches = useTwinMindStore((s) => s.suggestionBatches);
  const suggestionsBusy = useTwinMindStore((s) => s.suggestionsBusy);
  const chatBusy = useTwinMindStore((s) => s.chatBusy);
  const topBatchId = batches[0]?.id ?? "none";
  const [secondsLeft, setSecondsLeft] = useState(AUTO_REFRESH_SECONDS);

  useEffect(() => {
    setSecondsLeft(AUTO_REFRESH_SECONDS);
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          const st = useTwinMindStore.getState();
          const canRun =
            !!st.groqApiKey.trim() &&
            !st.suggestionsBusy &&
            (st.suggestionBatches.length > 0 || st.transcript.length > 0);
          if (canRun) {
            void scheduleSuggestionRefresh("manual");
          }
          return AUTO_REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [topBatchId]);

  const handleManualReload = () => {
    setSecondsLeft(AUTO_REFRESH_SECONDS);
    void scheduleSuggestionRefresh("manual");
  };

  return (
    <section className="flex min-h-0 flex-col overflow-hidden border-white/10 lg:border-r">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0f1419] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-200">2. Live suggestions</h2>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400">
          {batches.length} batch{batches.length === 1 ? "" : "es"}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0f1419] px-3 py-2">
        <button
          type="button"
          onClick={handleManualReload}
          disabled={suggestionsBusy}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ReloadIcon className="h-3.5 w-3.5" />
          Reload suggestions
        </button>
        <p className="text-[11px] text-slate-500">
          auto-refresh in <span className="font-mono text-slate-300">{secondsLeft}s</span>
        </p>
      </div>

      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto bg-[#0b0f14] px-3 py-2">
        {suggestionsBusy ? (
          <p className="mb-2 text-[11px] text-sky-400/90">Updating suggestions…</p>
        ) : null}

        {batches.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-5 text-center">
            <p className="text-sm font-medium text-slate-200">Waiting for context</p>
            <p className="mt-2 text-xs text-slate-500">
              After transcript lines arrive, batches appear here. You can reload or wait for the timer.
            </p>
          </div>
        ) : (
          batches.map((batch, batchIndex) => {
            const batchNumber = batches.length - batchIndex;
            const dim = Math.max(0.38, 1 - batchIndex * 0.12);
            const time = new Date(batch.createdAt).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });

            return (
              <div key={batch.id} className="mb-5 space-y-2 last:mb-0" style={{ opacity: dim }}>
                <div className="flex items-center gap-2 py-1 text-center text-[11px] font-mono uppercase tracking-[0.2em] text-slate-500">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="shrink-0">
                    — Batch {batchNumber} · {time} —
                  </span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="grid gap-2">
                  {batch.suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={chatBusy}
                      onClick={() => void expandSuggestionToChat(s)}
                      className="rounded-lg border border-white/10 bg-[#121820] p-3 text-left transition hover:border-sky-500/40 hover:bg-[#151d28] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <p
                        className={`text-[10px] font-bold uppercase tracking-wide ${suggestionTypeColorClass(s.type)}`}
                      >
                        {suggestionCardLabel(s.type)}
                      </p>
                      <p className="mt-1.5 text-sm leading-snug text-slate-100">{s.preview_text}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function ReloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 12a8 8 0 0114.9-3" strokeLinecap="round" />
      <path d="M20 12v-4h-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 01-14.9 3" strokeLinecap="round" />
      <path d="M4 12v4h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
