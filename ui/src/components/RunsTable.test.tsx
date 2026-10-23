import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-123",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-123",
    repo: "acme/widgets",
    branchName: "agent/eng-123",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/eng-123",
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

  it("renders a row with issue title, repo, PR number, and a link to the run detail page", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();

    const link = screen.getByText("Fix the bug").closest("a");
    expect(link?.getAttribute("href")).toBe("/runs/run-1");
  });

  it("falls back to the issue identifier, then the truncated issue id, when no title is set", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-123")).toBeDefined();

    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null }),
    ]);
    expect(screen.getByText("issue-ab")).toBeDefined();
  });

  it("renders em-dash for prNumber when not set", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is present", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();

    renderTable([makeRun()]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("shows Approve/Reject plan buttons for AwaitingPlanApproval and calls the API on click", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    expect(screen.getByTitle("Reject Plan")).toBeDefined();

    await userEvent.click(approveBtn);

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("calls rejectPlan when the Reject Plan button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("shows a Pause button for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("shows a Resume button for AIBlocked and HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("does not render Pause/Resume/Approve controls for a Done run, only the chevron link", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
  });

  it("swallows action errors and does not call onAction when the API call rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await vi.waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledOnce());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not throw when onAction is omitted after a successful action", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await vi.waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledOnce());
  });
});
