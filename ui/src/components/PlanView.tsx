import { cn } from "@/lib/utils.ts";
import { AlertTriangle, HelpCircle, ListChecks, GitCompareArrows } from "lucide-react";

interface PlanViewProps {
  plan: Record<string, unknown>;
}

export function PlanView({ plan }: PlanViewProps) {
  const steps = (plan.steps ?? []) as Array<{
    id: string;
    title: string;
    description: string;
  }>;
  const assumptions = (plan.assumptions ?? []) as string[];
  const risks = (plan.risks ?? []) as string[];
  const openQuestions = (plan.openQuestions ?? []) as Array<{
    id: string;
    question: string;
    requiredForExecution: boolean;
  }>;
  const confidence = plan.confidence as number | undefined;
  const summary = plan.summary as string | undefined;
  const requirementsTraceability = plan.requirementsTraceability as string | undefined;
  const version = plan.planVersion as number | undefined;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {version != null && (
            <span className="text-xs font-mono text-text-muted">
              v{version}
            </span>
          )}
        </div>
        {confidence != null && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 rounded-full bg-border overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  confidence >= 0.7
                    ? "bg-state-done"
                    : confidence >= 0.4
                      ? "bg-state-waiting"
                      : "bg-state-blocked",
                )}
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums">
              {(confidence * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-sm text-text-secondary leading-relaxed">{summary}</p>
      )}

      {/* Requirements Traceability */}
      {requirementsTraceability && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <GitCompareArrows size={14} className="text-accent" />
            <h4 className="text-sm font-medium">Requirements Traceability</h4>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">
            {requirementsTraceability}
          </p>
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ListChecks size={14} className="text-accent" />
            <h4 className="text-sm font-medium">Steps</h4>
          </div>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div
                key={step.id}
                className="rounded border border-border-subtle p-2.5"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-mono text-text-muted min-w-[1.5rem]">
                    {i + 1}.
                  </span>
                  <div>
                    <div className="text-xs font-medium">{step.title}</div>
                    <div className="text-xs text-text-secondary mt-0.5">
                      {step.description}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assumptions */}
      {assumptions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-1.5">Assumptions</h4>
          <ul className="space-y-1">
            {assumptions.map((a, i) => (
              <li key={i} className="text-xs text-text-secondary flex gap-2">
                <span className="text-text-muted">&#x2022;</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Risks */}
      {risks.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={12} className="text-state-warning" />
            <h4 className="text-sm font-medium">Risks</h4>
          </div>
          <ul className="space-y-1">
            {risks.map((r, i) => (
              <li key={i} className="text-xs text-text-secondary flex gap-2">
                <span className="text-state-blocked">&#x2022;</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Open Questions */}
      {openQuestions.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <HelpCircle size={12} className="text-state-waiting" />
            <h4 className="text-sm font-medium">Open Questions</h4>
          </div>
          <div className="space-y-1.5">
            {openQuestions.map((q) => (
              <div
                key={q.id}
                className="text-xs text-text-secondary flex items-start gap-2"
              >
                <span className="text-state-waiting mt-px">?</span>
                <span>
                  {q.question}
                  {q.requiredForExecution && (
                    <span className="ml-1.5 text-[10px] text-state-blocked font-medium">
                      blocks execution
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
