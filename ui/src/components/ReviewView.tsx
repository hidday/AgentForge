import { cn } from "@/lib/utils.ts";

const SEVERITY_STYLES: Record<string, string> = {
  blocker: "bg-severity-blocker/10 text-severity-blocker border-severity-blocker/30",
  important: "bg-severity-important/10 text-severity-important border-severity-important/30",
  suggestion: "bg-severity-suggestion/10 text-severity-suggestion border-severity-suggestion/30",
  nit: "bg-severity-nit/10 text-severity-nit border-severity-nit/30",
};

interface ReviewViewProps {
  review: Record<string, unknown>;
}

export function ReviewView({ review }: ReviewViewProps) {
  const verdict = review.overallVerdict as string | undefined;
  const summary = review.summary as string | undefined;
  const findings = (review.findings ?? []) as Array<{
    id: string;
    severity: string;
    type?: string;
    file?: string;
    lineHint?: number;
    affectedStepId?: string;
    title: string;
    details: string;
  }>;

  return (
    <div className="space-y-4">
      {/* Verdict */}
      {verdict && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">Verdict:</span>
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              verdict === "approved"
                ? "bg-state-done-bg text-state-done"
                : "bg-state-blocked-bg text-state-blocked",
            )}
          >
            {verdict === "approved" ? "Approved" : "Changes Requested"}
          </span>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <p className="text-sm text-text-secondary leading-relaxed">{summary}</p>
      )}

      {/* Findings */}
      {findings.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">
            Findings ({findings.length})
          </h4>
          <div className="space-y-2">
            {findings.map((f) => (
              <div
                key={f.id}
                className="rounded border border-border-subtle p-2.5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full border font-medium uppercase",
                      SEVERITY_STYLES[f.severity] ?? SEVERITY_STYLES.nit,
                    )}
                  >
                    {f.severity}
                  </span>
                  <span className="text-xs font-medium">{f.title}</span>
                </div>
                {(f.file || f.affectedStepId) && (
                  <div className="text-[10px] font-mono text-text-muted mb-1">
                    {f.file && (
                      <span>
                        {f.file}
                        {f.lineHint != null && `:${f.lineHint}`}
                      </span>
                    )}
                    {f.affectedStepId && (
                      <span>Step: {f.affectedStepId}</span>
                    )}
                  </div>
                )}
                <p className="text-xs text-text-secondary">{f.details}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
