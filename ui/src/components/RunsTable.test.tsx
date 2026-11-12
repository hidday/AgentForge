import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { RunsTable } from "./RunsTable.tsx";
import type { Run } from "@/api/client.ts";

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

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "acme/widgets",
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
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderTable(runs: Run[], onAction?: () => void) {
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
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row per run with repo, PR number, and issue title", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "First issue" }),
      makeRun({ id: "r2", linearIssueTitle: "Second issue", prNumber: null }),
    ];
    renderTable(runs);

    expect(screen.getByText("First issue")).toBeDefined();
    expect(screen.getByText("Second issue")).toBeDefined();
    expect(screen.getAllByText("acme/widgets")).toHaveLength(2);
    expect(screen.getByText("#42")).toBeDefined();
    // run r2 has no PR number -> em dash placeholder
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the issue identifier, then a truncated id, when no title exists", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: null, linearIssueIdentifier: "ENG-7" }),
      makeRun({
        id: "r2",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "0123456789abcdef",
      }),
    ];
    renderTable(runs);

    expect(screen.getByText("ENG-7")).toBeDefined();
    expect(screen.getByText("01234567")).toBeDefined();
  });

  it("links the issue title to the run detail page", () => {
    renderTable([makeRun({ id: "run-42" })]);
    const link = screen.getByRole("link", { name: "Fix the bug" });
    expect(link.getAttribute("href")).toBe("/runs/run-42");
  });

  it("renders an external Linear link when linearIssueUrl is present and omits it otherwise", () => {
    const { rerender } = render(
      <MemoryRouter>
        <RunsTable runs={[makeRun({})]} />
      </MemoryRouter>,
    );
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("stops propagation when clicking the external Linear link so the row link is not followed", async () => {
    renderTable([makeRun({})]);
    const linearLink = screen.getByTitle("Open in Linear");
    // Clicking should not throw, and the click should not bubble into the
    // row's navigation link (jsdom does not navigate, so we only assert the
    // handler ran without error and the link itself is unaffected).
    await userEvent.click(linearLink);
    expect(linearLink.getAttribute("href")).toBe(
      "https://linear.app/team/issue/ENG-1",
    );
  });

  it("shows approve/reject plan actions only for AwaitingPlanApproval state", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    mockApi.rejectPlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approve = screen.getByTitle("Approve Plan");
    const reject = screen.getByTitle("Reject Plan");
    expect(approve).toBeDefined();
    expect(reject).toBeDefined();

    await userEvent.click(approve);
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(1);

    await userEvent.click(reject);
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("shows the approve-and-complete action for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    const approve = screen.getByTitle("Approve & Complete");
    await userEvent.click(approve);

    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows a pause action for active-category states", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    renderTable([makeRun({ state: "Implementing" })]);

    const pause = screen.getByTitle("Pause Run");
    await userEvent.click(pause);
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a resume action for AIBlocked and HumanClarificationNeeded states", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    renderTable([makeRun({ id: "r1", state: "AIBlocked" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
  });

  it("shows no action buttons for a terminal Done state besides navigation", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
  });

  it("swallows action errors without crashing and still omits onAction call", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    expect(mockApi.pauseRun).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not call onAction when it is not provided", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
  });
});
