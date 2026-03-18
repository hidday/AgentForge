import { cn } from "@/lib/utils.ts";
import { getStateCategory } from "@/lib/stateColors.ts";
import { Check, Circle, Loader2 } from "lucide-react";
import type { RunEventRecord } from "@/api/client.ts";
import { relativeTime } from "@/lib/utils.ts";

const HAPPY_PATH_STATES = [
  "Todo",
  "Planning",
  "PlanReview",
  "AwaitingPlanApproval",
  "Implementing",
  "AIReview",
  "ReadyForHumanReview",
  "Done",
];

const SIDE_STATES: Record<string, string> = {
  PlanRevision: "PlanReview",
  AddressingReview: "AIReview",
  AIBlocked: "blocked",
  HumanClarificationNeeded: "blocked",
};

const STATE_LABELS: Record<string, string> = {
  Todo: "To Do",
  Planning: "Planning",
  PlanReview: "Plan Review",
  AwaitingPlanApproval: "Awaiting Approval",
  Implementing: "Implementing",
  AIReview: "AI Review",
  ReadyForHumanReview: "Human Review",
  Done: "Done",
};

interface WorkflowStepperProps {
  currentState: string;
  events: RunEventRecord[];
}

export function WorkflowStepper({ currentState, events }: WorkflowStepperProps) {
  const stateTimestamps = new Map<string, string>();
  for (const ev of events) {
    const payload = ev.payloadJson as { to?: string } | null;
    if (payload?.to && !stateTimestamps.has(payload.to)) {
      stateTimestamps.set(payload.to, ev.createdAt);
    }
  }

  const currentIdx = HAPPY_PATH_STATES.indexOf(currentState);
  const isSideState = currentState in SIDE_STATES;
  const effectiveIdx = isSideState
    ? HAPPY_PATH_STATES.indexOf(SIDE_STATES[currentState]!)
    : currentIdx;

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
        Workflow
      </h3>
      <div className="space-y-0">
        {HAPPY_PATH_STATES.map((state, idx) => {
          const isCompleted = effectiveIdx > idx || currentState === "Done";
          const isCurrent = state === currentState;
          const isUpcoming = !isCompleted && !isCurrent;
          const timestamp = stateTimestamps.get(state);

          return (
            <div key={state} className="relative flex items-start gap-3 pb-4">
              {idx < HAPPY_PATH_STATES.length - 1 && (
                <div
                  className={cn(
                    "absolute left-[11px] top-6 h-full w-px",
                    isCompleted ? "bg-state-done/40" : "bg-border",
                  )}
                />
              )}
              <div className="relative z-10 mt-0.5 flex-shrink-0">
                {isCompleted ? (
                  <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-state-done/20">
                    <Check size={12} className="text-state-done" />
                  </div>
                ) : isCurrent ? (
                  <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent/20">
                    <Loader2 size={12} className="text-accent animate-spin" />
                  </div>
                ) : (
                  <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface">
                    <Circle size={10} className="text-text-muted" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "text-sm font-medium",
                    isCompleted && "text-state-done",
                    isCurrent && "text-accent",
                    isUpcoming && "text-text-muted",
                  )}
                >
                  {STATE_LABELS[state]}
                </div>
                {timestamp && (
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {relativeTime(timestamp)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isSideState && (
        <div className="mt-2 rounded-md border border-border-subtle bg-surface p-2.5">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                getStateCategory(currentState) === "blocked"
                  ? "bg-state-blocked"
                  : "bg-state-active animate-pulse-dot",
              )}
            />
            <span className="text-xs font-medium text-text-secondary">
              {currentState === "PlanRevision" && "Revising Plan"}
              {currentState === "AddressingReview" && "Addressing Review"}
              {currentState === "AIBlocked" && "Blocked"}
              {currentState === "HumanClarificationNeeded" && "Needs Clarification"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
