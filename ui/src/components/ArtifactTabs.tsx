import { useState } from "react";
import type { Artifact } from "@/api/client.ts";
import { cn } from "@/lib/utils.ts";
import { PlanView } from "./PlanView.tsx";
import { ReviewView } from "./ReviewView.tsx";
import { ExecutionReportView } from "./ExecutionReportView.tsx";

type TabId = "plan" | "planReview" | "planRevision" | "execution" | "review" | "remediation" | "rejectionFeedback";

interface TabDef {
  id: TabId;
  label: string;
  artifactType: string;
}

const TABS: TabDef[] = [
  { id: "plan", label: "Plan", artifactType: "Plan" },
  { id: "planReview", label: "Plan Review", artifactType: "PlanReview" },
  { id: "planRevision", label: "Plan Revision", artifactType: "PlanRevision" },
  { id: "execution", label: "Execution", artifactType: "ExecutionReport" },
  { id: "review", label: "Code Review", artifactType: "Review" },
  { id: "remediation", label: "Remediation", artifactType: "Remediation" },
  { id: "rejectionFeedback", label: "Rejection Feedback", artifactType: "RejectionContext" },
];

interface ArtifactTabsProps {
  artifacts: Artifact[];
}

export function ArtifactTabs({ artifacts }: ArtifactTabsProps) {
  const availableTabs = TABS.filter((tab) =>
    artifacts.some((a) => a.type === tab.artifactType),
  );

  const [activeTab, setActiveTab] = useState<TabId>(
    availableTabs[0]?.id ?? "plan",
  );

  if (availableTabs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted text-sm">
        No artifacts yet — the run hasn't produced any output.
      </div>
    );
  }

  const activeTabDef = TABS.find((t) => t.id === activeTab);
  // For rejectionFeedback, collect all matching artifacts (possibly multiple rejections)
  const activeArtifacts =
    activeTab === "rejectionFeedback"
      ? artifacts.filter((a) => a.type === "RejectionContext")
      : [];
  const activeArtifact =
    activeTab !== "rejectionFeedback"
      ? artifacts.find((a) => a.type === activeTabDef?.artifactType)
      : undefined;

  return (
    <div>
      <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border mb-4">
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeTab === tab.id
                ? "bg-accent text-white"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        {activeTab === "rejectionFeedback" ? (
          activeArtifacts.length > 0 ? (
            <RejectionFeedbackView artifacts={activeArtifacts} />
          ) : (
            <div className="text-center py-8 text-text-muted text-sm">
              No rejection feedback recorded
            </div>
          )
        ) : activeArtifact ? (
          <ArtifactContent artifact={activeArtifact} tabId={activeTab} />
        ) : (
          <div className="text-center py-8 text-text-muted text-sm">
            No data available
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactContent({
  artifact,
  tabId,
}: {
  artifact: Artifact;
  tabId: TabId;
}) {
  const payload = artifact.payloadJson as Record<string, unknown>;

  switch (tabId) {
    case "plan":
      return <PlanView plan={payload} />;
    case "planReview":
    case "review":
      return <ReviewView review={payload} />;
    case "planRevision":
      return <PlanRevisionView revision={payload} />;
    case "execution":
      return <ExecutionReportView report={payload} />;
    case "remediation":
      return <RemediationView remediation={payload} />;
    case "rejectionFeedback":
      return null;
    default:
      return (
        <pre className="text-xs font-mono text-text-secondary overflow-auto">
          {JSON.stringify(payload, null, 2)}
        </pre>
      );
  }
}

interface RejectionContextArtifactPayload {
  planVersion: number;
  feedback: string;
  source: "api" | "linear";
}

function RejectionFeedbackView({ artifacts }: { artifacts: Artifact[] }) {
  // Sort descending by version so latest rejection appears first
  const sorted = [...artifacts].sort((a, b) => b.version - a.version);

  return (
    <div className="space-y-3">
      {sorted.map((artifact) => {
        const payload = artifact.payloadJson as RejectionContextArtifactPayload;
        return (
          <div key={artifact.id} className="rounded border border-border-subtle p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-text-primary">
                Plan V{payload.planVersion} Rejection
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-state-blocked-bg text-state-blocked">
                {payload.source}
              </span>
            </div>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{payload.feedback}</p>
          </div>
        );
      })}
    </div>
  );
}

function PlanRevisionView({
  revision,
}: {
  revision: Record<string, unknown>;
}) {
  const dispositions = (revision.dispositions ?? []) as Array<{
    findingId: string;
    status: string;
    rationale: string;
  }>;

  if (dispositions.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-sm">
        No dispositions recorded
      </div>
    );
  }

  const statusStyle = (status: string) => {
    switch (status) {
      case "accepted":
        return "bg-state-done-bg text-state-done";
      case "dismissed":
        return "bg-state-blocked-bg text-state-blocked";
      case "partially_incorporated":
        return "bg-state-waiting-bg text-state-waiting";
      default:
        return "bg-surface-hover text-text-muted";
    }
  };

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium">Review Finding Dispositions</h4>
      <div className="space-y-2">
        {dispositions.map((d) => (
          <div
            key={d.findingId}
            className="rounded border border-border-subtle p-2.5"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-accent">
                {d.findingId}
              </span>
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                  statusStyle(d.status),
                )}
              >
                {d.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="text-xs text-text-secondary">{d.rationale}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RemediationView({
  remediation,
}: {
  remediation: Record<string, unknown>;
}) {
  const resolution = (remediation.resolution ?? []) as Array<{
    findingId: string;
    status: string;
    action: string;
    rationale: string;
  }>;
  const rerunChecks = remediation.rerunChecks as Record<
    string,
    { status: string; details: string }
  > | null;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium mb-2">Resolutions</h4>
        <div className="space-y-2">
          {resolution.map((r) => (
            <div
              key={r.findingId}
              className="rounded border border-border-subtle p-2.5"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs text-accent">
                  {r.findingId}
                </span>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                    r.status === "accepted"
                      ? "bg-state-done-bg text-state-done"
                      : r.status === "rejected"
                        ? "bg-state-blocked-bg text-state-blocked"
                        : "bg-state-waiting-bg text-state-waiting",
                  )}
                >
                  {r.status}
                </span>
              </div>
              <p className="text-xs text-text-secondary">{r.action}</p>
              <p className="text-[10px] text-text-muted mt-1">
                {r.rationale}
              </p>
            </div>
          ))}
        </div>
      </div>

      {rerunChecks && (
        <div>
          <h4 className="text-sm font-medium mb-2">Re-run Checks</h4>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(rerunChecks).map(([name, check]) => (
              <div
                key={name}
                className="rounded border border-border-subtle p-2 text-center"
              >
                <div className="text-xs font-medium capitalize">{name}</div>
                <div
                  className={cn(
                    "text-xs mt-1",
                    check.status === "pass"
                      ? "text-state-done"
                      : check.status === "fail"
                        ? "text-state-blocked"
                        : "text-text-muted",
                  )}
                >
                  {check.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
