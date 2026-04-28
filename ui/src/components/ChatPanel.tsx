import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { api } from "@/api/client.ts";
import type { Artifact } from "@/api/client.ts";
import { Markdown } from "@/components/Markdown.tsx";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ChatPanelProps {
  runId: string;
  artifacts: Artifact[];
}

/**
 * ChatPanel — a collapsible run-scoped chat interface.
 *
 * Design principle: artifacts are the ONLY source of truth for rendered
 * messages. No optimistic inserts. After a successful send, the SSE-triggered
 * artifact refetch repopulates the list.
 */
export function ChatPanel({ runId, artifacts }: ChatPanelProps) {
  const [open, setOpen] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Derive messages from artifacts (sole source of truth)
  const messages: ChatMessage[] = artifacts
    .filter((a) => a.type === "ChatMessage")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((a) => {
      const payload = a.payloadJson as { role?: string; content?: string };
      return {
        id: a.id,
        role: (payload.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: payload.content ?? "",
        createdAt: a.createdAt,
      };
    });

  // Auto-scroll to bottom after each render
  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      await api.sendChatMessage(runId, trimmed);
      // Clear input on success. DO NOT insert messages locally — the SSE
      // event triggers useRun() artifact refetch which repopulates the list.
      setInputValue("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Chat request failed";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Chat with Agent</span>
          {messages.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-accent/20 text-accent text-xs font-medium px-2 py-0.5 min-w-[1.25rem]">
              {messages.length}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp size={16} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-text-muted flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Message list */}
          <div className="overflow-y-auto max-h-[400px] p-4 space-y-3">
            {messages.length === 0 && !isLoading ? (
              <p className="text-xs text-text-muted text-center py-4">
                No messages yet. Ask the agent anything about this run.
              </p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                      msg.role === "user"
                        ? "bg-accent/20 text-text-primary"
                        : "bg-surface-hover text-text-secondary"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <Markdown>{msg.content}</Markdown>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Loading indicator — only transient local UI element */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-surface-hover rounded-lg px-3 py-2 text-xs text-text-muted italic">
                  Agent is thinking&hellip;
                </div>
              </div>
            )}

            {/* Auto-scroll anchor */}
            <div ref={bottomRef} />
          </div>

          {/* Error message */}
          {error && (
            <div className="mx-4 mb-2 rounded border border-state-blocked/30 bg-state-blocked-bg px-3 py-2 text-xs text-state-blocked">
              {error}
            </div>
          )}

          {/* Input form */}
          <form onSubmit={(e) => void handleSubmit(e)} className="border-t border-border p-3 flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask the agent about this run…"
              disabled={isLoading}
              className="flex-1 rounded border border-border bg-surface-subtle px-3 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={12} />
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
