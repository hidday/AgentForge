import { cn } from "@/lib/utils.ts";
import { FileText, CheckCircle2, XCircle, MinusCircle, GitPullRequest } from "lucide-react";
import { Markdown } from "./Markdown.tsx";

interface ExecutionReportViewProps {
  report: Record<string, unknown>;
}

export function ExecutionReportView({ report }: ExecutionReportViewProps) {
  const summary = report.summary as string | undefined;
  const filesChanged = (report.filesChanged ?? []) as string[];
  const checks = report.checks as Record<
    string,
    { status: string; details: string }
  > | null;
  const notes = (report.notes ?? []) as string[];
  const prDraftCreated = report.prDraftCreated as boolean | undefined;
  const executionVersion = (report.executionVersion as number | undefined) ?? 1;
  const score = report.score as number | undefined;
  const scoreRationale = report.scoreRationale as string | undefined;

  return (
    <div className="space-y-5">
      {/* Header: version + score bar (mirrors PlanView confidence) */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-mono text-text-muted">
            v{executionVersion}
          </span>
        </div>
        {score != null && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 rounded-full bg-border overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  score >= 0.7
                    ? "bg-state-done"
                    : score >= 0.4
                      ? "bg-state-waiting"
                      : "bg-state-blocked",
                )}
                style={{ width: `${score * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums">
              Score: {(score * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Score rationale (italicized below the score bar, like PlanView's
          confidence-adjacent context) */}
      {score != null && scoreRationale && (
        <div className="text-xs italic text-text-muted -mt-3">
          {scoreRationale}
        </div>
      )}

      {/* Summary — rendered as markdown (executor is instructed to write
          markdown: headings, bullets, code refs). */}
      {summary && (
        <Markdown className="text-sm leading-relaxed">{summary}</Markdown>
      )}

      {/* Checks */}
      {checks && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 size={14} className="text-accent" />
            <h4 className="text-sm font-medium">Checks</h4>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(checks).map(([name, check]) => {
              const Icon =
                check.status === "pass"
                  ? CheckCircle2
                  : check.status === "fail"
                    ? XCircle
                    : MinusCircle;
              return (
                <div
                  key={name}
                  className={cn(
                    "rounded border p-3 text-center",
                    check.status === "pass"
                      ? "border-state-done/30 bg-state-done-bg"
                      : check.status === "fail"
                        ? "border-state-blocked/30 bg-state-blocked-bg"
                        : "border-border-subtle bg-surface",
                  )}
                >
                  <Icon
                    size={18}
                    className={cn(
                      "mx-auto mb-1",
                      check.status === "pass"
                        ? "text-state-done"
                        : check.status === "fail"
                          ? "text-state-blocked"
                          : "text-text-muted",
                    )}
                  />
                  <div className="text-xs font-medium capitalize">{name}</div>
                  <div className="text-[10px] text-text-muted mt-0.5 truncate">
                    {check.details}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Files Changed */}
      {filesChanged.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <FileText size={14} className="text-accent" />
            <h4 className="text-sm font-medium">
              Files Changed ({filesChanged.length})
            </h4>
          </div>
          <div className="rounded border border-border-subtle bg-background p-2 max-h-48 overflow-y-auto">
            {filesChanged.map((file) => (
              <div
                key={file}
                className="flex items-center gap-2 py-1 text-xs font-mono text-text-secondary"
              >
                <FileText size={12} className="text-text-muted flex-shrink-0" />
                {file}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {notes.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-1.5">Notes</h4>
          <ul className="space-y-1">
            {notes.map((note, i) => (
              <li key={i} className="text-xs flex gap-2">
                <span className="text-text-muted shrink-0">&#x2022;</span>
                <Markdown className="text-xs min-w-0 flex-1">{note}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      )}

      {prDraftCreated != null && (
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <GitPullRequest size={12} />
          PR Draft: {prDraftCreated ? "Created" : "Not created"}
        </div>
      )}
    </div>
  );
}
