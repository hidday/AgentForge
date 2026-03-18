const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface Run {
  id: string;
  linearIssueId: string;
  repo: string;
  branchName: string | null;
  prNumber: number | null;
  state: string;
  planVersion: number;
  approvedPlanVersion: number | null;
  plannerRuntime: string | null;
  executorRuntime: string | null;
  reviewerRuntime: string | null;
  remediationRuntime: string | null;
  workingDirectory: string;
  latestArtifactVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  runId: string;
  type: string;
  version: number;
  payloadJson: unknown;
  rawText: string;
  createdAt: string;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  eventType: string;
  source: string;
  payloadJson: unknown;
  createdAt: string;
}

export const api = {
  getRuns: (state?: string) =>
    request<{ runs: Run[] }>(`/runs${state ? `?state=${state}` : ""}`),

  getRun: (id: string) =>
    request<{ run: Run; artifacts: Artifact[]; events: RunEventRecord[] }>(`/runs/${id}`),

  getArtifacts: (runId: string) =>
    request<{ artifacts: Artifact[] }>(`/runs/${runId}/artifacts`),

  getEvents: (runId: string) =>
    request<{ events: RunEventRecord[] }>(`/runs/${runId}/events`),

  approvePlan: (runId: string) =>
    request<{ ok: boolean; state: string }>(`/runs/${runId}/actions/approve-plan`, {
      method: "POST",
    }),

  rejectPlan: (runId: string) =>
    request<{ ok: boolean; state: string }>(`/runs/${runId}/actions/reject-plan`, {
      method: "POST",
    }),

  approveReview: (runId: string) =>
    request<{ ok: boolean; state: string }>(`/runs/${runId}/actions/approve-review`, {
      method: "POST",
    }),

  pauseRun: (runId: string) =>
    request<{ ok: boolean }>(`/runs/${runId}/actions/pause`, { method: "POST" }),

  resumeRun: (runId: string) =>
    request<{ ok: boolean }>(`/runs/${runId}/actions/resume`, { method: "POST" }),
};
