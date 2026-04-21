import { useState, useEffect } from "react";
import { useRuns } from "@/hooks/useRuns.ts";
import { RunsTable } from "@/components/RunsTable.tsx";
import { LinearSyncDialog } from "@/components/LinearSyncDialog.tsx";
import { IngestSummaryBanner } from "@/components/IngestSummaryBanner.tsx";
import { cn } from "@/lib/utils.ts";
import type { StateCategory } from "@/lib/stateColors.ts";
import { RefreshCw } from "lucide-react";

const INGEST_BANNER_AUTO_DISMISS_MS = 5000;

const FILTERS: { label: string; value: StateCategory | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Awaiting Human", value: "waiting" },
  { label: "Blocked", value: "blocked" },
  { label: "Done", value: "done" },
];

const STATE_CATEGORY_MAP: Record<string, StateCategory> = {
  Todo: "idle",
  Planning: "active",
  PlanReview: "active",
  PlanRevision: "active",
  AwaitingPlanApproval: "waiting",
  Implementing: "active",
  AIReview: "active",
  AddressingReview: "active",
  ReadyForHumanReview: "waiting",
  Done: "done",
  AIBlocked: "blocked",
  HumanClarificationNeeded: "waiting",
};

interface IngestSummaryState {
  started: number;
  skipped: number;
  /** Bumped on each onIngestComplete so the auto-dismiss timer restarts. */
  key: number;
}

export function DashboardPage() {
  const [filter, setFilter] = useState<StateCategory | "all">("all");
  const [syncOpen, setSyncOpen] = useState(false);
  const [ingestSummary, setIngestSummary] = useState<IngestSummaryState | null>(null);
  const { runs, loading, error, refetch } = useRuns();

  useEffect(() => {
    if (!ingestSummary) return;
    const id = setTimeout(() => setIngestSummary(null), INGEST_BANNER_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [ingestSummary]);

  const filteredRuns =
    filter === "all"
      ? runs
      : runs.filter((r) => STATE_CATEGORY_MAP[r.state] === filter);

  const counts = runs.reduce(
    (acc, r) => {
      const cat = STATE_CATEGORY_MAP[r.state] ?? "idle";
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="min-h-screen px-6 py-8 max-w-7xl mx-auto">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent Runs</h1>
          <p className="text-text-secondary text-sm mt-1">
            Monitor and manage AI development agent runs
          </p>
        </div>
        <button
          onClick={() => setSyncOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <RefreshCw size={14} />
          Sync from Linear
        </button>
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: "Total", value: runs.length, color: "text-text-primary" },
          { label: "Active", value: counts["active"] ?? 0, color: "text-state-active" },
          { label: "Awaiting", value: counts["waiting"] ?? 0, color: "text-state-waiting" },
          { label: "Blocked", value: counts["blocked"] ?? 0, color: "text-state-blocked" },
          { label: "Done", value: counts["done"] ?? 0, color: "text-state-done" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border bg-surface px-4 py-3"
          >
            <div className={cn("text-2xl font-semibold tabular-nums", stat.color)}>
              {stat.value}
            </div>
            <div className="text-xs text-text-muted mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-1 mb-4 p-1 bg-surface rounded-lg border border-border w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              filter === f.value
                ? "bg-accent text-white"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {ingestSummary && (
        <IngestSummaryBanner
          started={ingestSummary.started}
          skipped={ingestSummary.skipped}
          onDismiss={() => setIngestSummary(null)}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-text-muted">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent mr-3" />
          Loading runs...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-state-blocked/30 bg-state-blocked-bg p-4 text-state-blocked text-sm">
          {error}
        </div>
      ) : (
        <RunsTable runs={filteredRuns} onAction={refetch} />
      )}

      <LinearSyncDialog
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onIngested={refetch}
        onIngestComplete={(s) =>
          setIngestSummary({ started: s.started, skipped: s.skipped, key: Date.now() })
        }
      />
    </div>
  );
}
