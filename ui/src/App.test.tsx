import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useSSE.ts", () => ({ useSSE: () => {} }));
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => ({ runs: [], loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: () => ({
    data: {
      run: {
        id: "run-1",
        linearIssueId: "issue-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueDescription: null,
        linearIssueTitle: "Fix the bug",
        linearIssueUrl: null,
        repo: "org/repo",
        branchName: null,
        prNumber: null,
        state: "Implementing",
        planVersion: 1,
        approvedPlanVersion: 1,
        plannerRuntime: null,
        executorRuntime: null,
        reviewerRuntime: null,
        remediationRuntime: null,
        workingDirectory: "/tmp",
        latestArtifactVersion: 1,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      } satisfies Run,
      artifacts: [],
      events: [],
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: () => ({ processes: [], hasActive: false, output: "", activeProcessId: null }),
}));

import App from "./App.tsx";

describe("App", () => {
  it("renders the DashboardPage at the root route", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Agent Runs")).toBeDefined();
    });
  });

  it("renders the RunDetailPage at /runs/:id", async () => {
    window.history.pushState({}, "", "/runs/run-1");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Run Detail")).toBeDefined();
    });
  });
});
