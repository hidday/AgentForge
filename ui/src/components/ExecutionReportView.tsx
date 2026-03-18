import { cn } from "@/lib/utils.ts";
import { FileText, CheckCircle2, XCircle, MinusCircle } from "lucide-react";

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

  return (
    <div className="space-y-4">
      {/* Summary */}
      {summary && (
        <p className="text-sm text-text-secondary leading-relaxed">{summary}</p>
      )}

      {/* Checks */}
      {checks && (
        <div>
          <h4 className="text-sm font-medium mb-2">Checks</h4>
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
          <h4 className="text-sm font-medium mb-2">
            Files Changed ({filesChanged.length})
          </h4>
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
              <li key={i} className="text-xs text-text-secondary flex gap-2">
                <span className="text-text-muted">&#x2022;</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prDraftCreated != null && (
        <div className="text-xs text-text-muted">
          PR Draft: {prDraftCreated ? "Created" : "Not created"}
        </div>
      )}
    </div>
  );
}
