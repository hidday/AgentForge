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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "acme/repo",
    branchName: "fix-bug",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    mockApi.approvePlan.mockResolvedValue(undefined);
    mockApi.rejectPlan.mockResolvedValue(undefined);
    mockApi.approveReview.mockResolvedValue(undefined);
    mockApi.pauseRun.mockResolvedValue(undefined);
    mockApi.resumeRun.mockResolvedValue(undefined);
  });

  it("renders the empty state when there are no runs", () => {
    renderTable([]);

    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row per run with issue title, repo, PR number, and a link to the run", () => {
    renderTable([makeRun()]);

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();

    const issueLink = screen.getByRole("link", { name: "Fix the bug" });
    expect(issueLink.getAttribute("href")).toBe("/runs/run-1");
  });

  it("falls back to the issue identifier when no title is set", () => {
    renderTable([
      makeRun({ id: "run-2", linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }),
    ]);
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to a slice of the raw issue id when neither title nor identifier is set", () => {
    renderTable([
      makeRun({
        id: "run-3",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh-1234",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an em dash instead of a PR number when there is no PR", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is set", () => {
    renderTable([makeRun()]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("omits the external Linear link when linearIssueUrl is not set", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject plan actions for AwaitingPlanApproval and calls the API on click", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    await user.click(approveBtn);

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());

    const rejectBtn = screen.getByTitle("Reject Plan");
    await user.click(rejectBtn);
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    await user.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("shows a Pause action for active-category states and calls pauseRun", async () => {
    const user = userEvent.setup();
    renderTable([makeRun({ state: "Implementing" })]);

    await user.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a Resume action for AIBlocked and calls resumeRun", async () => {
    const user = userEvent.setup();
    renderTable([makeRun({ state: "AIBlocked" })]);
    await user.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a Resume action for HumanClarificationNeeded", () => {
    renderTable([makeRun({ id: "run-4", state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("shows no state-specific action buttons for a terminal Done state", () => {
    renderTable([makeRun({ state: "Done" })]);

    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without calling onAction (handled by the API client)", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.pauseRun.mockRejectedValueOnce(new Error("network down"));
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await user.click(screen.getByTitle("Pause Run"));

    await vi.waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledOnce());
    expect(onAction).not.toHaveBeenCalled();
  });
});
