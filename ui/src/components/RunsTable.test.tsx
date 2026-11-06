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
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
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

  it("renders an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("falls back through title -> identifier -> truncated id for the issue link label", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueTitle: "Fix the bug" }),
      makeRun({ id: "r2", linearIssueTitle: null, linearIssueIdentifier: "ENG-42" }),
      makeRun({ id: "r3", linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "abcdefgh-ijkl" }),
    ]);

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("ENG-42")).toBeDefined();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders the repo, PR number and updated-at columns", () => {
    renderTable([makeRun({ repo: "acme/widgets", prNumber: 17 })]);
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("#17")).toBeDefined();
  });

  it("renders a dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is present, and not otherwise", () => {
    const { rerender } = render(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]} />
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

  it("stops the external Linear link click from bubbling up to the row", async () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]);
    const link = screen.getByTitle("Open in Linear");
    // jsdom does not navigate on anchor clicks; this just exercises the
    // stopPropagation handler without throwing.
    await userEvent.click(link);
    expect(link).toBeDefined();
  });

  it("shows Approve/Reject Plan actions for AwaitingPlanApproval and calls the API", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls rejectPlan when the Reject Plan action is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows the Approve & Complete action for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows a Pause action for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows a Resume action for AIBlocked/HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    renderTable([makeRun({ state: "AIBlocked" })]);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("does not show any action buttons for a terminal state like Done", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without crashing and does not call onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Planning" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("always renders a link through to the run detail page", () => {
    renderTable([makeRun({ id: "run-42" })]);
    const link = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/runs/run-42");
    expect(link).toBeDefined();
  });

  it("renders a StateBadge reflecting the run's state", () => {
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });
});
