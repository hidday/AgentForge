import { Check, X } from "lucide-react";

interface IngestSummaryBannerProps {
  started: number;
  skipped: number;
  onDismiss: () => void;
}

/**
 * Transient confirmation banner shown on the dashboard after a Linear-sync
 * ingestion. The Sync from Linear modal closes optimistically as soon as the
 * runs appear in the table, so this banner is the surface that tells the
 * user how many runs were actually started (and how many were skipped because
 * they already had an active run or failed to start).
 */
export function IngestSummaryBanner({
  started,
  skipped,
  onDismiss,
}: IngestSummaryBannerProps) {
  const startedLabel = `Started ${started} run${started === 1 ? "" : "s"}`;
  const skippedLabel = skipped > 0 ? `, skipped ${skipped}` : "";

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-lg border border-state-done/30 bg-state-done-bg px-4 py-2.5 text-sm text-state-done"
    >
      <Check size={14} className="shrink-0" />
      <span className="flex-1">
        {startedLabel}
        {skipped > 0 && <span className="text-text-muted">{skippedLabel}</span>}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
