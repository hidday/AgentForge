import { useState } from "react";
import { api } from "@/api/client.ts";
import { getStateCategory } from "@/lib/stateColors.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import {
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  RotateCcw,
  MessageSquare,
  RefreshCw,
  PenLine,
} from "lucide-react";

const RETRY_LABELS: Record<string, string> = {
  Todo: "Start Run",
  Planning: "Retry Planning",
  PlanRevision: "Retry Plan Revision",
  PlanReview: "Retry Plan Review",
  Implementing: "Retry Execution",
  AIReview: "Retry Code Review",
  AddressingReview: "Retry Remediation",
};

interface ActionBarProps {
  runId: string;
  state: string;
  onAction: () => void;
  onScrollToQuestions?: () => void;
  hasOptionalQuestions?: boolean;
}

type DialogConfig = {
  title: string;
  description: string;
  confirmLabel: string;
  variant: "default" | "destructive";
  action: (note?: string) => Promise<unknown>;
  notes?: {
    label?: string;
    placeholder?: string;
  };
} | null;

export function ActionBar({
  runId,
  state,
  onAction,
  onScrollToQuestions,
  hasOptionalQuestions = false,
}: ActionBarProps) {
  const [dialog, setDialog] = useState<DialogConfig>(null);
  const [loading, setLoading] = useState(false);
  const [rejectContext, setRejectContext] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectMode, setRejectMode] = useState<"iterate" | "fresh">("iterate");

  const category = getStateCategory(state);

  async function handleConfirm(note?: string) {
    if (!dialog) return;
    setLoading(true);
    try {
      await dialog.action(note);
      onAction();
    } catch {
      // handled by client
    } finally {
      setLoading(false);
      setDialog(null);
    }
  }

  async function handleRejectConfirm() {
    setLoading(true);
    try {
      await api.rejectPlan(runId, rejectContext.trim() || undefined, rejectMode);
      onAction();
    } catch {
      // handled by client
    } finally {
      setLoading(false);
      setShowRejectDialog(false);
      setRejectContext("");
      setRejectMode("iterate");
    }
  }

  function handleRejectCancel() {
    setShowRejectDialog(false);
    setRejectContext("");
    setRejectMode("iterate");
  }

  const reReviewDialog: DialogConfig = {
    title: "Re-review Plan",
    description:
      "Run the plan reviewer again against the current plan. The run will return to Awaiting Plan Approval after the review completes.",
    confirmLabel: "Re-review",
    variant: "default",
    action: (note) => api.reReviewPlan(runId, note),
    notes: {
      label: "Notes for the plan reviewer (optional)",
      placeholder: "e.g. focus on the test plan, or flag risks I've raised below...",
    },
  };

  const revisePlanDialog: DialogConfig = {
    title: "Revise Plan",
    description:
      "Run the plan reviewer and, if changes are requested, automatically run the plan reviser to produce a new plan version.",
    confirmLabel: "Revise",
    variant: "default",
    action: (note) => api.revisePlan(runId, note),
    notes: {
      label: "Notes for the plan reviser (optional)",
      placeholder: "e.g. tighten the rollout step, or expand testing for X...",
    },
  };

  const actions: Array<{
    show: boolean;
    icon: typeof CheckCircle2;
    label: string;
    style: string;
    dialog: DialogConfig;
  }> = [
    {
      show: state === "AwaitingPlanApproval",
      icon: CheckCircle2,
      label: "Approve Plan",
      style: "bg-state-done text-white hover:bg-state-done/80",
      dialog: {
        title: "Approve Plan",
        description:
          "This will approve the current plan and start implementation. The AI agent will begin coding.",
        confirmLabel: "Approve & Start",
        variant: "default",
        action: (note) => api.approvePlan(runId, note),
        notes: {
          label: "Notes for the executor (optional)",
          placeholder: "e.g. extra context, edge cases to watch, gotchas the plan glossed over...",
        },
      },
    },
    {
      show: state === "AwaitingPlanApproval",
      icon: XCircle,
      label: "Reject Plan",
      style: "bg-state-blocked text-white hover:bg-state-blocked/80",
      // Use null here — this button opens the custom reject dialog instead
      dialog: null,
    },
    {
      show: state === "ReadyForHumanReview",
      icon: CheckCircle2,
      label: "Approve & Complete",
      style: "bg-state-done text-white hover:bg-state-done/80",
      dialog: {
        title: "Approve & Complete",
        description:
          "This will mark the run as complete. Make sure you've reviewed the PR.",
        confirmLabel: "Complete Run",
        variant: "default",
        action: () => api.approveReview(runId),
      },
    },
    {
      show: category === "active",
      icon: Pause,
      label: "Pause",
      style: "border border-border text-text-secondary hover:bg-surface-hover",
      dialog: {
        title: "Pause Run",
        description:
          "This will pause the run. You can resume it later.",
        confirmLabel: "Pause",
        variant: "default",
        action: () => api.pauseRun(runId),
      },
    },
    {
      show:
        state === "AIBlocked" || state === "HumanClarificationNeeded" || state === "Failed",
      icon: Play,
      label: "Resume",
      style: "bg-accent text-white hover:bg-accent-hover",
      dialog: {
        title: "Resume Run",
        description:
          "This will reset the run back to the start. It will begin re-planning.",
        confirmLabel: "Resume",
        variant: "default",
        action: () => api.resumeRun(runId),
      },
    },
    {
      show: state in RETRY_LABELS,
      icon: RotateCcw,
      label: RETRY_LABELS[state] ?? "Retry",
      style: "bg-accent text-white hover:bg-accent-hover",
      dialog: {
        title: RETRY_LABELS[state] ?? "Retry Stage",
        description:
          `Re-run the current stage (${state}). The agent will pick up from where it left off using existing artifacts.`,
        confirmLabel: "Retry",
        variant: "default",
        action: () => api.retryStage(runId),
      },
    },
  ];

  const visibleActions = actions.filter((a) => a.show);

  // Direct-action buttons (no confirmation dialog)
  const showAnswerQuestionsBtn = state === "HumanClarificationNeeded";
  const showAnswerOptionalBtn = state === "AwaitingPlanApproval" && hasOptionalQuestions;
  const showReReviewBtn = state === "AwaitingPlanApproval";
  const showRevisePlanBtn = state === "AwaitingPlanApproval";

  if (visibleActions.length === 0 && !showAnswerQuestionsBtn && !showAnswerOptionalBtn && !showReReviewBtn && !showRevisePlanBtn) {
    return null;
  }

  return (
    <>
      <div className="sticky bottom-0 z-10 border-t border-border bg-surface/80 backdrop-blur-sm px-4 lg:px-6 py-3">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {showAnswerQuestionsBtn && (
            <button
              key="answer-questions"
              onClick={onScrollToQuestions}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <MessageSquare size={14} />
              Answer Questions
            </button>
          )}

          {showAnswerOptionalBtn && (
            <button
              key="answer-optional-questions"
              onClick={onScrollToQuestions}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover"
            >
              <MessageSquare size={14} />
              Answer Optional Questions
            </button>
          )}

          {showReReviewBtn && (
            <button
              key="re-review-plan"
              onClick={() => setDialog(reReviewDialog)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover"
            >
              <RefreshCw size={14} />
              Re-review Plan
            </button>
          )}

          {showRevisePlanBtn && (
            <button
              key="revise-plan"
              onClick={() => setDialog(revisePlanDialog)}
              className="flex items-center gap-1.5 rounded-md border border-accent/40 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
            >
              <PenLine size={14} />
              Revise Plan
            </button>
          )}

          {visibleActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={() => {
                  if (action.label === "Reject Plan") {
                    setShowRejectDialog(true);
                  } else {
                    setDialog(action.dialog);
                  }
                }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${action.style}`}
              >
                <Icon size={14} />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.description ?? ""}
        confirmLabel={dialog?.confirmLabel ?? ""}
        variant={dialog?.variant ?? "default"}
        notes={dialog?.notes}
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setDialog(null)}
      />

      {showRejectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleRejectCancel}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-base font-semibold mb-1">Reject Plan</h3>
            <p className="text-sm text-text-secondary mb-3">
              This will reject the current plan and send it back for re-planning.
            </p>
            <div className="flex gap-1 p-0.5 bg-surface-hover rounded-lg mb-3">
              <button
                type="button"
                onClick={() => setRejectMode("iterate")}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  rejectMode === "iterate"
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <div>Revise plan</div>
                <div className="font-normal mt-0.5 opacity-80">Iterate with full context</div>
              </button>
              <button
                type="button"
                onClick={() => setRejectMode("fresh")}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  rejectMode === "fresh"
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <div>Start fresh</div>
                <div className="font-normal mt-0.5 opacity-80">Clean slate, feedback only</div>
              </button>
            </div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Feedback (optional)
            </label>
            <textarea
              className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent mb-4"
              rows={3}
              placeholder="Optional: describe what should change in the next plan..."
              value={rejectContext}
              onChange={(e) => setRejectContext(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleRejectCancel}
                disabled={loading}
                className="px-3 py-1.5 text-sm rounded-md border border-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={loading}
                className="px-3 py-1.5 text-sm rounded-md font-medium bg-state-blocked text-white hover:bg-state-blocked/80 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Working...
                  </span>
                ) : (
                  "Reject Plan"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
