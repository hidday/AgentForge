import { useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useRun } from "@/hooks/useRun.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { StateBadge } from "@/components/StateBadge.tsx";
import { WorkflowStepper } from "@/components/WorkflowStepper.tsx";
import { ArtifactTabs } from "@/components/ArtifactTabs.tsx";
import { AgentOutputPanel } from "@/components/AgentOutputPanel.tsx";
import { EventTimeline } from "@/components/EventTimeline.tsx";
import { ActionBar } from "@/components/ActionBar.tsx";
import { OpenQuestionsPanel } from "@/components/OpenQuestionsPanel.tsx";
import type { OpenQuestion } from "@/components/OpenQuestionsPanel.tsx";
import { formatTimestamp } from "@/lib/utils.ts";
import { ArrowLeft, GitBranch, ExternalLink } from "lucide-react";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useRun(id!);
  const { processes, output } = useActiveProcesses(id!);
  const questionsRef = useRef<HTMLDivElement>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-text-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent mr-3" />
        Loading run...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen px-6 py-8 max-w-7xl mx-auto">
        <div className="rounded-lg border border-state-blocked/30 bg-state-blocked-bg p-4 text-state-blocked text-sm">
          {error ?? "Run not found"}
        </div>
      </div>
    );
  }

  const { run, artifacts, events } = data;

  // Extract open questions from the latest Plan artifact
  const planArtifact = artifacts.find((a) => a.type === "Plan");
  const planPayload = planArtifact?.payloadJson as
    | { openQuestions?: OpenQuestion[] }
    | undefined;
  const allOpenQuestions: OpenQuestion[] = planPayload?.openQuestions ?? [];
  const optionalQuestions = allOpenQuestions.filter((q) => !q.requiredForExecution);

  function scrollToQuestions() {
    questionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <Link
              to="/"
              className="text-text-muted hover:text-text-secondary transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-lg font-semibold">Run Detail</h1>
          </div>

          <div className="flex items-center flex-wrap gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">ID:</span>
              <span className="font-mono text-xs text-text-secondary">
                {run.id.slice(0, 8)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Issue:</span>
              <span className="text-xs text-accent font-medium">
                {run.linearIssueTitle || run.linearIssueId.slice(0, 8)}
              </span>
              {run.linearIssueUrl && (
                <a
                  href={run.linearIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-accent hover:text-accent-hover hover:bg-surface-hover transition-colors"
                  title="Open in Linear"
                >
                  <ExternalLink size={12} />
                  Linear
                </a>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Repo:</span>
              <span className="font-mono text-xs text-text-secondary">
                {run.repo}
              </span>
            </div>

            {run.branchName && (
              <div className="flex items-center gap-1.5">
                <GitBranch size={12} className="text-text-muted" />
                <span className="font-mono text-xs text-text-secondary">
                  {run.branchName}
                </span>
              </div>
            )}

            {run.prNumber && (
              <div className="flex items-center gap-1.5">
                <ExternalLink size={12} className="text-text-muted" />
                <span className="font-mono text-xs text-accent">
                  PR #{run.prNumber}
                </span>
              </div>
            )}

            <StateBadge state={run.state} />

            <span className="text-xs text-text-muted">
              Created {formatTimestamp(run.createdAt)}
            </span>
          </div>
        </div>
      </header>

      {/* Three-panel layout */}
      <div className="flex-1 max-w-7xl mx-auto w-full grid grid-cols-[220px_1fr_260px] gap-4 px-6 py-5">
        {/* Left: Workflow */}
        <aside className="overflow-y-auto">
          <WorkflowStepper currentState={run.state} events={events} />
        </aside>

        {/* Center: Artifacts + Agent Output */}
        <main className="min-w-0 space-y-4">
          {/* HumanClarificationNeeded: show interactive questions panel prominently */}
          {run.state === "HumanClarificationNeeded" && allOpenQuestions.length > 0 && (
            <div ref={questionsRef}>
              <OpenQuestionsPanel
                questions={allOpenQuestions}
                runId={run.id}
                readOnly={false}
                onSubmitted={refetch}
              />
            </div>
          )}

          <AgentOutputPanel processes={processes} output={output} />
          <ArtifactTabs artifacts={artifacts} />

          {/* AwaitingPlanApproval: optional questions as collapsible secondary panel */}
          {run.state === "AwaitingPlanApproval" && optionalQuestions.length > 0 && (
            <div ref={questionsRef}>
              <OpenQuestionsPanel
                questions={optionalQuestions}
                runId={run.id}
                readOnly={false}
                onSubmitted={refetch}
              />
            </div>
          )}
        </main>

        {/* Right: Events */}
        <aside className="overflow-y-auto">
          <EventTimeline events={events} />
        </aside>
      </div>

      {/* Action Bar */}
      <ActionBar
        runId={run.id}
        state={run.state}
        onAction={refetch}
        onScrollToQuestions={scrollToQuestions}
        hasOptionalQuestions={optionalQuestions.length > 0}
      />
    </div>
  );
}
