import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import { RunsTable } from "./RunsTable.tsx";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix/bug",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderTable(runs: Run[]) {
  return render(
    <MemoryRouter>
      <RunsTable runs={runs} />
    </MemoryRouter>,
  );
}

describe("RunsTable – external Linear link click isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops the click event from propagating when the external Linear link is clicked", () => {
    renderTable([makeRun()]);
    const externalLink = screen.getByTitle("Open in Linear");

    const nativeEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagationSpy = vi.spyOn(nativeEvent, "stopPropagation");

    externalLink.dispatchEvent(nativeEvent);

    expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
  });
});
