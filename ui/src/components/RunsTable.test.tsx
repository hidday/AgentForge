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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(overrides: Partial<Run> = {}): Run {
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
    workingDirectory: "/tmp/run-1",
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

  it("shows an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders issue title, repo, and PR number for a run", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to the Linear identifier when there is no title", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is no title or identifier", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "abcdefgh12345" }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an em dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders a Linear external link only when linearIssueUrl is set", () => {
    renderTable([makeRun()]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryAllByTitle("Open in Linear")).toHaveLength(1); // still just the first render's
  });

  it("shows approve/reject plan actions for AwaitingPlanApproval and calls the API", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls rejectPlan when the reject button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows approve & complete action for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a pause action for active-category states and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each(["AIBlocked", "HumanClarificationNeeded"])(
    "shows a resume action for %s and calls resumeRun",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      renderTable([makeRun({ state })], onAction);

      await userEvent.click(screen.getByTitle("Resume Run"));

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("does not call onAction when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not render any action buttons for a state with no applicable actions", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("works without an onAction callback", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
  });
});
