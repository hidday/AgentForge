import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: () => {},
}));

vi.mock("@/api/client.ts", () => ({
  api: {
    fetchPendingIssues: vi.fn(),
    ingestIssues: vi.fn(),
  },
}));

import { DashboardPage } from "./DashboardPage.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { fetchPendingIssues: ReturnType<typeof vi.fn> };

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some run",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
  });

  it("falls back to the 'idle' bucket (not shown in the stat tiles) for a run whose state isn't in the category map", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r1", state: "SomeUnmappedFutureState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const statLabel = (label: string) => screen.getByText(label, { selector: "div" });
    expect(statLabel("Total").previousSibling?.textContent).toBe("1");
    expect(statLabel("Active").previousSibling?.textContent).toBe("0");
    expect(statLabel("Awaiting").previousSibling?.textContent).toBe("0");
    expect(statLabel("Blocked").previousSibling?.textContent).toBe("0");
    expect(statLabel("Done").previousSibling?.textContent).toBe("0");
  });
});
