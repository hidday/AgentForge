import type { RunState } from "./runState.js";
import type { RunEvent } from "./runEvent.js";

export interface Run {
  id: string;
  linearIssueId: string;
  repo: string;
  branchName: string | null;
  prNumber: number | null;
  state: RunState;
  planVersion: number;
  approvedPlanVersion: number | null;
  plannerRuntime: string | null;
  executorRuntime: string | null;
  reviewerRuntime: string | null;
  remediationRuntime: string | null;
  workingDirectory: string;
  latestArtifactVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ArtifactType =
  | "Plan"
  | "PlanReview"
  | "PlanRevision"
  | "ExecutionReport"
  | "Review"
  | "Remediation"
  | "PlannerTranscript"
  | "PlanReviewerTranscript"
  | "PlanReviserTranscript"
  | "ExecutorTranscript"
  | "ReviewerTranscript"
  | "RemediationTranscript";

export interface Artifact {
  id: string;
  runId: string;
  type: ArtifactType;
  version: number;
  payloadJson: unknown;
  rawText: string;
  createdAt: Date;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  eventType: RunEvent | string;
  source: string;
  payloadJson: unknown;
  createdAt: Date;
}

export type AgentRuntime = "claude-code" | "codex" | "cursor";

export interface AgentStage {
  runtime: AgentRuntime;
  name: string;
}

export const AGENT_STAGES = {
  planner: { runtime: "claude-code" as const, name: "planner" },
  planReviewer: { runtime: "codex" as const, name: "plan-reviewer" },
  planReviser: { runtime: "claude-code" as const, name: "plan-reviser" },
  executor: { runtime: "claude-code" as const, name: "executor" },
  reviewer: { runtime: "codex" as const, name: "reviewer" },
  remediation: { runtime: "claude-code" as const, name: "remediation" },
} as const;
