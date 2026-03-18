import { useState } from "react";
import { api } from "@/api/client.ts";
import { getStateCategory } from "@/lib/stateColors.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import {
  CheckCircle2,
  XCircle,
  Pause,
  Play,
} from "lucide-react";

interface ActionBarProps {
  runId: string;
  state: string;
  onAction: () => void;
}

type DialogConfig = {
  title: string;
  description: string;
  confirmLabel: string;
  variant: "default" | "destructive";
  action: () => Promise<unknown>;
} | null;

export function ActionBar({ runId, state, onAction }: ActionBarProps) {
  const [dialog, setDialog] = useState<DialogConfig>(null);
  const [loading, setLoading] = useState(false);

  const category = getStateCategory(state);

  async function handleConfirm() {
    if (!dialog) return;
    setLoading(true);
    try {
      await dialog.action();
      onAction();
    } catch {
      // handled by client
    } finally {
      setLoading(false);
      setDialog(null);
    }
  }

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
        action: () => api.approvePlan(runId),
      },
    },
    {
      show: state === "AwaitingPlanApproval",
      icon: XCircle,
      label: "Reject Plan",
      style: "bg-state-blocked text-white hover:bg-state-blocked/80",
      dialog: {
        title: "Reject Plan",
        description:
          "This will reject the current plan and send it back for re-planning.",
        confirmLabel: "Reject Plan",
        variant: "destructive",
        action: () => api.rejectPlan(runId),
      },
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
        state === "AIBlocked" || state === "HumanClarificationNeeded",
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
  ];

  const visibleActions = actions.filter((a) => a.show);

  if (visibleActions.length === 0) return null;

  return (
    <>
      <div className="sticky bottom-0 z-10 border-t border-border bg-surface/80 backdrop-blur-sm px-6 py-3">
        <div className="flex items-center justify-end gap-2">
          {visibleActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={() => setDialog(action.dialog)}
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
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}
