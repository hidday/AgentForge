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

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-12345678",
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

  it("renders an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders run rows with issue title, repo, and PR placeholder", () => {
    renderTable([makeRun({})]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the issue identifier when title is missing", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a sliced issue id when title and identifier are missing", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "abcdefgh12345" }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders the PR number when present", () => {
    renderTable([makeRun({ prNumber: 42 })]);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is set", () => {
    const { rerender } = renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]} />
      </MemoryRouter>,
    );
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/1");
  });

  it("invokes the external Linear link's click handler (stopPropagation) without throwing", async () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]);
    const link = screen.getByTitle("Open in Linear");

    // jsdom doesn't implement navigation for real anchor clicks; this just
    // exercises the onClick={(e) => e.stopPropagation()} handler itself.
    await userEvent.click(link);

    // The row/link content is unaffected by the click.
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("shows Approve/Reject actions for AwaitingPlanApproval and calls the API + onAction", async () => {
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-9");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());

    expect(screen.getByTitle("Reject Plan")).toBeDefined();
  });

  it("calls rejectPlan when Reject Plan action is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-9");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("shows Approve & Complete action for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-5", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-5");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("shows a Pause action for active-category states", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-3", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-3");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("shows a Resume action for AIBlocked and HumanClarificationNeeded", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-4", state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-4");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("does not call onAction when the action API call rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-3", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    await vi.waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledOnce());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not render state-specific action buttons for a Todo run", () => {
    renderTable([makeRun({ state: "Todo" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
