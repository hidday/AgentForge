import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", async () => {
  const actual = await vi.importActual<typeof import("@/api/client.ts")>(
    "@/api/client.ts",
  );
  return {
    ...actual,
    api: {
      approvePlan: vi.fn(),
      rejectPlan: vi.fn(),
      approveReview: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
    },
  };
});

import { RunsTable } from "./RunsTable.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
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

  it("renders empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("falls back through title -> identifier -> truncated id for the issue link label", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueTitle: "Fix the bug" }),
      makeRun({ id: "r2", linearIssueTitle: null, linearIssueIdentifier: "ENG-123" }),
      makeRun({
        id: "r3",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "0123456789",
      }),
    ]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("ENG-123")).toBeDefined();
    expect(screen.getByText("01234567")).toBeDefined();
  });

  it("renders Linear external link only when linearIssueUrl is present", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueUrl: "https://linear.app/issue/1" }),
      makeRun({ id: "r2", linearIssueTitle: "No url run" }),
    ]);
    const links = screen.getAllByTitle("Open in Linear");
    expect(links.length).toBe(1);
  });

  it("stops the Linear external link click from bubbling up to ancestor handlers", async () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <MemoryRouter>
          <RunsTable
            runs={[makeRun({ id: "r1", linearIssueUrl: "https://linear.app/issue/1" })]}
          />
        </MemoryRouter>
      </div>,
    );

    await userEvent.click(screen.getByTitle("Open in Linear"));

    expect(parentClick).not.toHaveBeenCalled();
  });

  it("renders PR number when present, em dash when absent", () => {
    renderTable([
      makeRun({ id: "r1", prNumber: 42 }),
      makeRun({ id: "r2", prNumber: null }),
    ]);
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("shows approve/reject buttons for AwaitingPlanApproval state and calls approvePlan", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("calls rejectPlan when reject button clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
    });
  });

  it("shows Approve & Complete button for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("shows Pause button for active-category states and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "r1", state: "Implementing" })]);

    const pauseBtn = screen.getByTitle("Pause Run");
    await userEvent.click(pauseBtn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
    });
  });

  it("shows Resume button for AIBlocked and HumanClarificationNeeded states and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([
      makeRun({ id: "r1", state: "AIBlocked" }),
      makeRun({ id: "r2", state: "HumanClarificationNeeded" }),
    ]);

    const resumeBtns = screen.getAllByTitle("Resume Run");
    expect(resumeBtns.length).toBe(2);

    await userEvent.click(resumeBtns[0]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
    });
  });

  it("renders no action buttons for a terminal state like Done", () => {
    renderTable([makeRun({ id: "r1", state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("does not call onAction and does not throw when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback supplied", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "r1", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
    });
  });
});
