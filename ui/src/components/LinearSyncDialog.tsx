import { useState, useEffect } from "react";
import { api, type LinearIssue } from "@/api/client.ts";
import { cn } from "@/lib/utils.ts";
import { RefreshCw, Check, AlertTriangle, Inbox } from "lucide-react";

const PRIORITY_LABELS: Record<number, { label: string; className: string }> = {
  0: { label: "None", className: "text-text-muted" },
  1: { label: "Urgent", className: "text-state-blocked" },
  2: { label: "High", className: "text-state-warning" },
  3: { label: "Medium", className: "text-state-active" },
  4: { label: "Low", className: "text-text-muted" },
};

interface LinearSyncDialogProps {
  open: boolean;
  onClose: () => void;
  onIngested: () => void;
}

export function LinearSyncDialog({ open, onClose, onIngested }: LinearSyncDialogProps) {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ started: string[]; skipped: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    void fetchIssues();
  }, [open]);

  async function fetchIssues() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.fetchPendingIssues();
      setIssues(data.issues);
      setSelected(new Set(data.issues.map((i) => i.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch issues");
    } finally {
      setLoading(false);
    }
  }

  function toggleAll() {
    if (selected.size === issues.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(issues.map((i) => i.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  async function handleIngest() {
    if (selected.size === 0) return;
    setIngesting(true);
    setError(null);
    try {
      const data = await api.ingestIssues([...selected]);
      setResult(data);
      if (data.started.length > 0) {
        onIngested();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ingest issues");
    } finally {
      setIngesting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-surface shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Sync from Linear</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Pull pending "Todo" issues from configured Linear projects
            </p>
          </div>
          <button
            onClick={fetchIssues}
            disabled={loading}
            className="rounded-md p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent mr-3" />
              Fetching issues from Linear...
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 py-8 justify-center text-state-blocked text-sm">
              <AlertTriangle size={16} />
              {error}
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Inbox size={32} className="mb-2 opacity-50" />
              <p className="text-sm">No pending issues found</p>
              <p className="text-xs mt-1">All "Todo" issues already have active runs</p>
            </div>
          ) : result ? (
            <div className="space-y-3 py-4">
              {result.started.length > 0 && (
                <div className="rounded-md border border-state-done/30 bg-state-done-bg p-3">
                  <div className="flex items-center gap-2 text-state-done text-sm font-medium">
                    <Check size={14} />
                    Started {result.started.length} run{result.started.length > 1 ? "s" : ""}
                  </div>
                </div>
              )}
              {result.skipped.length > 0 && (
                <div className="rounded-md border border-border-subtle bg-surface p-3">
                  <div className="text-text-muted text-sm">
                    Skipped {result.skipped.length} (already tracked or failed)
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Select all */}
              <label className="flex items-center gap-2 py-2 border-b border-border-subtle mb-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.size === issues.length}
                  onChange={toggleAll}
                  className="rounded border-border accent-accent"
                />
                <span className="text-xs font-medium text-text-secondary">
                  Select all ({issues.length})
                </span>
              </label>

              {/* Issue list */}
              <div className="space-y-1">
                {issues.map((issue) => {
                  const prio = PRIORITY_LABELS[issue.priority] ?? PRIORITY_LABELS[0];
                  return (
                    <label
                      key={issue.id}
                      className="flex items-start gap-3 rounded-md p-2.5 hover:bg-surface-hover transition-colors cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(issue.id)}
                        onChange={() => toggleOne(issue.id)}
                        className="mt-0.5 rounded border-border accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{issue.title}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="font-mono text-[10px] text-text-muted">
                            {issue.id.slice(0, 8)}
                          </span>
                          {issue.project && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-text-secondary">
                              {issue.project}
                            </span>
                          )}
                          <span className={cn("text-[10px] font-medium", prio!.className)}>
                            {prio!.label}
                          </span>
                          {issue.labels.map((l) => (
                            <span
                              key={l}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && issues.length > 0 && (
            <button
              onClick={handleIngest}
              disabled={selected.size === 0 || ingesting}
              className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {ingesting ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Starting...
                </span>
              ) : (
                `Start ${selected.size} Run${selected.size > 1 ? "s" : ""}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
