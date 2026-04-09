import { Link } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import { StateBadge } from "./StateBadge.tsx";
import { relativeTime } from "@/lib/utils.ts";
import { getStateCategory } from "@/lib/stateColors.ts";
import {
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  ChevronRight,
} from "lucide-react";
import { api } from "@/api/client.ts";

interface RunsTableProps {
  runs: Run[];
  onAction?: () => void;
}

export function RunsTable({ runs, onAction }: RunsTableProps) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-muted">
        <div className="text-4xl mb-3">&#x2205;</div>
        <p className="text-sm">No runs found</p>
      </div>
    );
  }

  async function handleAction(
    e: React.MouseEvent,
    action: () => Promise<unknown>,
  ) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await action();
      onAction?.();
    } catch {
      // errors are handled by the API client
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="px-4 py-3 text-left font-medium text-text-secondary">
              State
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary">
              Issue
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary">
              Repo
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary">
              PR
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary">
              Updated
            </th>
            <th className="px-4 py-3 text-right font-medium text-text-secondary">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const category = getStateCategory(run.state);
            return (
              <tr
                key={run.id}
                className="border-b border-border-subtle last:border-0 hover:bg-surface-hover transition-colors"
              >
                <td className="px-4 py-3">
                  <StateBadge state={run.state} />
                </td>
                <td className="px-4 py-3">
                  <Link
                    to={`/runs/${run.id}`}
                    className="text-xs text-accent hover:text-accent-hover transition-colors"
                  >
                    {run.linearIssueTitle || run.linearIssueId.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                  {run.repo}
                </td>
                <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                  {run.prNumber ? `#${run.prNumber}` : "—"}
                </td>
                <td className="px-4 py-3 text-text-muted text-xs">
                  {relativeTime(run.updatedAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {run.state === "AwaitingPlanApproval" && (
                      <>
                        <button
                          onClick={(e) =>
                            handleAction(e, () => api.approvePlan(run.id))
                          }
                          className="rounded p-1 text-state-done hover:bg-state-done/10 transition-colors"
                          title="Approve Plan"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                        <button
                          onClick={(e) =>
                            handleAction(e, () => api.rejectPlan(run.id))
                          }
                          className="rounded p-1 text-state-blocked hover:bg-state-blocked/10 transition-colors"
                          title="Reject Plan"
                        >
                          <XCircle size={16} />
                        </button>
                      </>
                    )}
                    {run.state === "ReadyForHumanReview" && (
                      <button
                        onClick={(e) =>
                          handleAction(e, () => api.approveReview(run.id))
                        }
                        className="rounded p-1 text-state-done hover:bg-state-done/10 transition-colors"
                        title="Approve & Complete"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                    {category === "active" && (
                      <button
                        onClick={(e) =>
                          handleAction(e, () => api.pauseRun(run.id))
                        }
                        className="rounded p-1 text-state-waiting hover:bg-state-waiting/10 transition-colors"
                        title="Pause Run"
                      >
                        <Pause size={16} />
                      </button>
                    )}
                    {(run.state === "AIBlocked" ||
                      run.state === "HumanClarificationNeeded") && (
                      <button
                        onClick={(e) =>
                          handleAction(e, () => api.resumeRun(run.id))
                        }
                        className="rounded p-1 text-state-active hover:bg-state-active/10 transition-colors"
                        title="Resume Run"
                      >
                        <Play size={16} />
                      </button>
                    )}
                    <Link
                      to={`/runs/${run.id}`}
                      className="rounded p-1 text-text-muted hover:text-text-secondary transition-colors"
                    >
                      <ChevronRight size={16} />
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
