"use client";

import { useEffect, useRef } from "react";
import { useMeetingRecorder } from "@/hooks/useMeetingRecorder";
import { buildSessionExport, downloadTextFile } from "@/lib/sessionExport";
import { useTwinMindStore } from "@/store/useTwinMindStore";

export function TranscriptColumn() {
  const transcript = useTwinMindStore((s) => s.transcript);
  const { isRecording, isPipelineBusy, start, stop } = useMeetingRecorder();

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  const handleExport = () => {
    const s = useTwinMindStore.getState();
    const payload = {
      exportedAt: new Date().toISOString(),
      transcript: s.transcript,
      suggestionBatches: s.suggestionBatches,
      chatMessages: s.chatMessages,
    };
    const body = buildSessionExport(payload);
    const stamp = new Date().toISOString().replaceAll(":", "-");
    downloadTextFile(`twinmind-session-${stamp}.json`, body, "application/json");
  };

  const statusLabel = isPipelineBusy ? "TRANSCRIBING" : isRecording ? "LIVE" : "IDLE";

  return (
    <section className="flex min-h-0 flex-col overflow-hidden border-white/10 lg:border-r">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0f1419] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-200">1. Mic &amp; transcript</h2>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400">
          {statusLabel}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#0f1419] px-3 py-3">
        <button
          type="button"
          onClick={() => (isRecording ? stop() : void start())}
          className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 transition ${
            isRecording
              ? "border-rose-400/80 bg-rose-600 text-white shadow-lg shadow-rose-900/40"
              : "border-sky-500 bg-slate-900 text-sky-400 hover:bg-slate-800"
          }`}
          aria-label={isRecording ? "Stop microphone" : "Start microphone"}
        >
          {isRecording ? <PauseGlyph className="h-6 w-6" /> : <PlayGlyph className="ml-0.5 h-6 w-6" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">
            {isRecording ? "Listening…" : "Stopped. Click to resume."}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            ~30s segments → Whisper. Export includes this column.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5"
        >
          Export
        </button>
      </div>

      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto bg-[#0b0f14] px-3 py-2">
        {transcript.length === 0 ? (
          <EmptyState
            title="No transcript yet"
            body="Paste your Groq API key in Settings, then tap the blue control to start."
          />
        ) : (
          <ul className="space-y-3">
            {transcript.map((line) => (
              <li key={line.id} className="border-b border-white/5 pb-3 last:border-0">
                <div className="mb-1 font-mono text-[11px] text-slate-500">
                  {new Date(line.createdAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })}
                </div>
                <p className="text-sm leading-relaxed text-slate-100">{line.text}</p>
              </li>
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-5 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-2 text-xs text-slate-500">{body}</p>
    </div>
  );
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}
