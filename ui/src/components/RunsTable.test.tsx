import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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

import { RunsTable } from "./RunsTable.tsx";
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
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
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
  });

  it("renders issue title, repo, and a dash for a missing PR number", () => {
    renderTable([makeRun({})]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the issue identifier, then the issue id, when title is missing", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7" }),
    ]);
    expect(screen.getByText("ENG-7")).toBeDefined();
  });

  it("falls back to a truncated issue id when both title and identifier are missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders the PR number when present", () => {
    renderTable([makeRun({ prNumber: 42 })]);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/1");
  });

  it("stops the click on the Linear link from propagating to the row", async () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]);
    const link = screen.getByTitle("Open in Linear");
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagationSpy = vi.spyOn(clickEvent, "stopPropagation");
    link.dispatchEvent(clickEvent);
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("does not render a Linear link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows approve/reject plan actions for AwaitingPlanApproval and calls the API on click", async () => {
    mockApi.approvePlan.mockResolvedValue(undefined);
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
  });

  it("calls rejectPlan when the reject button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows the approve-and-complete action for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows the pause action for an active-category state", async () => {
    mockApi.pauseRun.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows the resume action for AIBlocked and HumanClarificationNeeded states", async () => {
    mockApi.resumeRun.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "AIBlocked" })]);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("does not render any action buttons for a Done run", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
  });

  it("swallows action errors without calling onAction", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("links to the run detail page", () => {
    renderTable([makeRun({})]);
    const link = screen.getByRole("link", { name: "Fix the bug" });
    expect(link.getAttribute("href")).toBe("/runs/run-1");
  });
});
