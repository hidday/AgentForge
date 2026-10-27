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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
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

  it("renders issue title, repo, PR number, and a dash when no PR exists", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders the PR number when present", () => {
    renderTable([makeRun({ prNumber: 42 })]);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to the issue identifier when title is missing", () => {
    renderTable([makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7" })]);
    expect(screen.getByText("ENG-7")).toBeDefined();
  });

  it("falls back to a truncated issue id when title and identifier are missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders a Linear external link only when linearIssueUrl is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("omits the Linear external link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject actions for AwaitingPlanApproval and calls api.approvePlan", async () => {
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

  it("calls api.rejectPlan when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows Pause for an active-category state and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows Resume for AIBlocked and calls api.resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "AIBlocked" })]);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("does not call onAction when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not render any action buttons for a terminal Done state with no matching category", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("links the issue title and chevron to the run detail page", () => {
    renderTable([makeRun({ id: "run-99" })]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-99")).toBe(true);
  });
});
