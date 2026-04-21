import { useState, useEffect, useRef, useCallback } from "react";
import { api, type LinearIssue } from "@/api/client.ts";
import { useSSE, type DashboardEvent } from "@/hooks/useSSE.ts";
import { cn } from "@/lib/utils.ts";
import { RefreshCw, AlertTriangle, Inbox } from "lucide-react";

const PRIORITY_LABELS: Record<number, { label: string; className: string }> = {
  0: { label: "None", className: "text-text-muted" },
  1: { label: "Urgent", className: "text-state-blocked" },
  2: { label: "High", className: "text-state-warning" },
  3: { label: "Medium", className: "text-state-active" },
  4: { label: "Low", className: "text-text-muted" },
};

/**
 * Minimum time (ms) the "Starting..." loader stays visible after the user
 * clicks Start, even if the runs show up faster. Avoids a jarring flash and
 * gives the user a clear visual confirmation that something happened.
 */
const MIN_LOADER_MS = 600;

export interface IngestSummary {
  started: number;
  skipped: number;
}

interface LinearSyncDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called when at least one run has been successfully started so the parent
   * can refetch the runs list. Equivalent to the prior onIngested signal.
   */
  onIngested: () => void;
  /**
   * Called once when the dialog auto-closes following a successful ingest.
   * The summary may be synthesized from observed SSE events (started =
   * pendingIds.length, skipped = 0) when the long backend response hasn't
   * landed yet, and may be called a second time with the authoritative
   * counts once the HTTP response resolves.
   */
  onIngestComplete?: (summary: IngestSummary) => void;
}

export function LinearSyncDialog({
  open,
  onClose,
  onIngested,
  onIngestComplete,
}: LinearSyncDialogProps) {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set of pending issue IDs we're currently waiting on (a snapshot of
  // `selected` at the moment Start was clicked). Empty when not ingesting.
  const pendingIdsRef = useRef<string[]>([]);
  // Issue IDs we've observed via SSE `run:created` since clicking Start.
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Authoritative response from /linear/ingest, once it arrives.
  const ingestResultRef = useRef<{ started: string[]; skipped: string[] } | null>(null);
  // Whether the HTTP request has settled (resolved or rejected). Tracked
  // separately from `ingestResultRef` so error paths still let the close
  // logic decide what to do.
  const ingestSettledRef = useRef(false);
  // Timestamp (ms) of the click, used to enforce MIN_LOADER_MS.
  const startedAtRef = useRef<number>(0);
  // Whether we've already triggered the auto-close for this ingest cycle.
  const closedRef = useRef(false);
  // Retained timer id for the MIN_LOADER_MS-delayed close, so we can clear
  // it if the dialog is unmounted mid-flight.
  const minDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void fetchIssues();
    // Reset all ingest tracking state when the dialog re-opens.
    pendingIdsRef.current = [];
    seenIdsRef.current = new Set();
    ingestResultRef.current = null;
    ingestSettledRef.current = false;
    closedRef.current = false;
    setIngesting(false);
    if (minDelayTimerRef.current) {
      clearTimeout(minDelayTimerRef.current);
      minDelayTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (minDelayTimerRef.current) clearTimeout(minDelayTimerRef.current);
    };
  }, []);

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

  /**
   * Closes the dialog if the close conditions are met:
   *  - we haven't already closed for this cycle (closedRef),
   *  - we're inside an ingest cycle (pendingIdsRef populated),
   *  - either every selected issue has been observed via SSE OR the HTTP
   *    request has settled with a usable result, and
   *  - at least MIN_LOADER_MS has passed since the user clicked Start.
   *
   * If the conditions are otherwise met but we're inside the minimum-delay
   * window, schedules a follow-up evaluation to fire as soon as the window
   * elapses.
   *
   * Note: this function intentionally reads ingest state exclusively from
   * refs (not the `ingesting` state value) so callers invoked from
   * already-suspended async closures (e.g. inside the awaited ingestIssues
   * promise) see fresh values rather than the stale render snapshot.
   */
  const maybeAutoClose = useCallback(() => {
    if (closedRef.current) return;
    const pendingIds = pendingIdsRef.current;
    if (pendingIds.length === 0) return;

    const allSeen = pendingIds.every((id) => seenIdsRef.current.has(id));
    const settled = ingestSettledRef.current;
    if (!allSeen && !settled) return;

    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed < MIN_LOADER_MS) {
      if (minDelayTimerRef.current) return; // already scheduled
      minDelayTimerRef.current = setTimeout(() => {
        minDelayTimerRef.current = null;
        maybeAutoClose();
      }, MIN_LOADER_MS - elapsed);
      return;
    }

    closedRef.current = true;
    const result = ingestResultRef.current;
    const summary: IngestSummary = result
      ? { started: result.started.length, skipped: result.skipped.length }
      : { started: pendingIds.length, skipped: 0 };
    onIngestComplete?.(summary);
    setIngesting(false);
    onClose();
  }, [onClose, onIngestComplete]);

  const handleSSE = useCallback(
    (event: DashboardEvent) => {
      if (event.type !== "run:created") return;
      const issueId = event.issueId as string | undefined;
      if (!issueId) return;
      if (!pendingIdsRef.current.includes(issueId)) return;
      seenIdsRef.current.add(issueId);
      maybeAutoClose();
    },
    [maybeAutoClose],
  );

  useSSE(handleSSE);

  async function handleIngest() {
    if (selected.size === 0) return;
    const pendingIds = [...selected];
    pendingIdsRef.current = pendingIds;
    seenIdsRef.current = new Set();
    ingestResultRef.current = null;
    ingestSettledRef.current = false;
    closedRef.current = false;
    startedAtRef.current = Date.now();
    setError(null);
    setIngesting(true);

    let sawAtLeastOneStart = false;

    try {
      const data = await api.ingestIssues(pendingIds);
      ingestResultRef.current = data;
      ingestSettledRef.current = true;
      sawAtLeastOneStart = data.started.length > 0;
      maybeAutoClose();
    } catch (err) {
      ingestSettledRef.current = true;
      // On error: keep the dialog open so the user can see what went wrong.
      // Don't auto-close. Reset the pending tracker so a subsequent retry
      // starts cleanly.
      pendingIdsRef.current = [];
      setIngesting(false);
      setError(err instanceof Error ? err.message : "Failed to ingest issues");
      return;
    }

    // Even if we already triggered the optimistic close from SSE, fire
    // onIngested + a final onIngestComplete so the dashboard sees the
    // authoritative started/skipped counts.
    if (sawAtLeastOneStart) onIngested();
    if (closedRef.current && ingestResultRef.current) {
      const r = ingestResultRef.current;
      onIngestComplete?.({ started: r.started.length, skipped: r.skipped.length });
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
            Cancel
          </button>
          {issues.length > 0 && (
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
