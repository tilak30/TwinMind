"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendDirectChatMessage } from "@/services/chatActions";
import { useTwinMindStore } from "@/store/useTwinMindStore";

export function ChatColumn() {
  const messages = useTwinMindStore((s) => s.chatMessages);
  const chatBusy = useTwinMindStore((s) => s.chatBusy);
  const [draft, setDraft] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chatBusy]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || chatBusy) return;
    const text = draft;
    setDraft("");
    void sendDirectChatMessage(text);
  };

  return (
    <section className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0f1419] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-200">3. Chat (detailed answers)</h2>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400">
          Session-only
        </span>
      </div>

      <div className="tm-scroll min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#0b0f14] px-3 py-2">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-5 text-center">
            <p className="text-sm font-medium text-slate-200">No messages</p>
            <p className="mt-2 text-xs text-slate-500">Tap a suggestion or type below. Plain text replies.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`max-w-[98%] ${m.role === "user" ? "ml-auto text-right" : "mr-auto"}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {m.role === "user" ? (
                  <>
                    <span className="text-sky-400/90">You</span>
                    {m.userTag ? (
                      <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-slate-400">
                        {m.userTag}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-emerald-400/90">Assistant</span>
                )}
              </div>
              <div
                className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "border-sky-500/25 bg-sky-950/40 text-slate-50"
                    : "border-white/10 bg-[#121820] text-slate-100"
                }`}
              >
                <p className="whitespace-pre-wrap text-left">{m.content}</p>
              </div>
            </div>
          ))
        )}
        {chatBusy ? (
          <div className="mr-auto max-w-[90%] rounded-xl border border-white/10 bg-[#121820]/90 px-3 py-2 text-left text-xs text-slate-400">
            Assistant is typing…
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <footer className="shrink-0 border-t border-white/10 bg-[#0f1419] p-2">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={chatBusy}
            placeholder="Ask anything…"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0b0f14] px-3 py-2 text-sm text-white outline-none ring-sky-500/30 placeholder:text-slate-500 focus:ring-2 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={chatBusy || !draft.trim()}
            className="shrink-0 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </footer>
    </section>
  );
}
