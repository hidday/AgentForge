import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
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
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderTable(runs: Run[], onAction = vi.fn()) {
  return render(
    <MemoryRouter>
      <RunsTable runs={runs} onAction={onAction} />
    </MemoryRouter>,
  );
}

describe("RunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders run fields: title link, repo, PR number, and Linear link", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("falls back to identifier then to a sliced issue id when title is missing", () => {
    renderTable([
      makeRun({ id: "r2", linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }),
    ]);
    expect(screen.getByText("ENG-9")).toBeDefined();

    renderTable([
      makeRun({
        id: "r3",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows a dash when there is no PR number and omits the Linear link when there's no URL", () => {
    renderTable([makeRun({ prNumber: null, linearIssueUrl: null })]);
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject Plan buttons for AwaitingPlanApproval and calls the API on click", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await user.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(1);

    mockApi.rejectPlan.mockResolvedValue(undefined);
    await user.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approveReview.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    await user.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows Pause for an active-category state and calls pauseRun", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.pauseRun.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await user.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows Resume for AIBlocked and HumanClarificationNeeded and calls resumeRun", async () => {
    const user = userEvent.setup();
    mockApi.resumeRun.mockResolvedValue(undefined);
    const first = renderTable([makeRun({ id: "rb", state: "AIBlocked" })]);
    await user.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("rb");
    first.unmount();

    mockApi.resumeRun.mockClear();
    renderTable([makeRun({ id: "rc", state: "HumanClarificationNeeded" })]);
    await user.click(screen.getAllByTitle("Resume Run")[0]!);
    expect(mockApi.resumeRun).toHaveBeenCalledWith("rc");
  });

  it("swallows action errors without calling onAction", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await user.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders a chevron link to the run detail page for every row", () => {
    renderTable([makeRun()]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-1")).toBe(true);
  });
});
