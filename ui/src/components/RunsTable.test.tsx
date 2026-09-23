import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    linearIssueId: "issue-1234567890",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
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

  it("renders run rows with repo, PR number, and issue link using linearIssueTitle", () => {
    renderTable([makeRun({ prNumber: 42 })]);
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("shows an em-dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when title is missing", () => {
    renderTable([makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" })]);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is present", () => {
    const { rerender } = render(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]} />
      </MemoryRouter>,
    );
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/1");

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ id: "run-2", linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("stops click propagation on the external Linear link so the row link isn't also triggered", async () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]);
    const link = screen.getByTitle("Open in Linear");
    const stopPropagation = vi.spyOn(MouseEvent.prototype, "stopPropagation");
    await userEvent.click(link);
    expect(stopPropagation).toHaveBeenCalled();
    stopPropagation.mockRestore();
  });

  it("shows Approve/Reject actions for AwaitingPlanApproval and calls the API with the run id", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-approve", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-approve");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls rejectPlan when the Reject Plan action is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-reject", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));
    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-reject");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Approve & Complete action for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-review", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-review");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Pause action for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-active", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-active");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Resume action for AIBlocked/HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-blocked", state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));
    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-blocked");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not render any state-specific action buttons for a Done run", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("does not call onAction when the action API call rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-fail", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback (optional prop)", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-noop", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
  });

  it("renders multiple rows for multiple runs", () => {
    renderTable([
      makeRun({ id: "run-a", linearIssueTitle: "Run A" }),
      makeRun({ id: "run-b", linearIssueTitle: "Run B" }),
    ]);
    expect(screen.getByText("Run A")).toBeDefined();
    expect(screen.getByText("Run B")).toBeDefined();
  });
});
