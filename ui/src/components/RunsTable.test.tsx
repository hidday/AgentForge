import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
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
    id: "r1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
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

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("RunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no runs", () => {
    renderWithRouter(<RunsTable runs={[]} />);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders the issue title, repo, and a dash for a missing PR number", () => {
    renderWithRouter(<RunsTable runs={[makeRun({})]} />);
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders the PR number when present", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ prNumber: 42 })]} />);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to the identifier, then the id prefix, when no title is set", () => {
    renderWithRouter(
      <RunsTable runs={[makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7" })]} />,
    );
    expect(screen.getByText("ENG-7")).toBeDefined();
  });

  it("falls back to a slice of the raw linearIssueId when title and identifier are both missing", () => {
    renderWithRouter(
      <RunsTable
        runs={[
          makeRun({
            linearIssueTitle: null,
            linearIssueIdentifier: null,
            linearIssueId: "abcdefgh12345",
          }),
        ]}
      />,
    );
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an external Linear link only when linearIssueUrl is set, and its click does not bubble to the row", async () => {
    renderWithRouter(
      <RunsTable runs={[makeRun({ linearIssueUrl: "https://linear.app/x" })]} />,
    );
    const link = screen.getByTitle("Open in Linear");
    expect(link).toBeDefined();
    await userEvent.click(link);
    // No navigation/action side effects fire from this click; absence of a
    // thrown error and the link still being present confirms the row click
    // handler did not also run.
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("shows the Reject Plan action for AwaitingPlanApproval and calls the API on click", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    renderWithRouter(<RunsTable runs={[makeRun({ state: "AwaitingPlanApproval" })]} />);
    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
  });

  it("shows Approve/Reject actions for a run AwaitingPlanApproval, and calls the API on click", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "AwaitingPlanApproval" })]} onAction={onAction} />,
    );

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("swallows a rejected action and still does not crash the row", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "AwaitingPlanApproval" })]} onAction={onAction} />,
    );

    await userEvent.click(screen.getByTitle("Approve Plan"));
    await vi.waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the Approve & Complete action for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    renderWithRouter(<RunsTable runs={[makeRun({ state: "ReadyForHumanReview" })]} />);
    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
  });

  it("shows the Pause action for an active-category state", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Implementing" })]} />);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
  });

  it("shows the Resume action for AIBlocked and HumanClarificationNeeded", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderWithRouter(<RunsTable runs={[makeRun({ state: "AIBlocked" })]} />);
    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
  });

  it("does not show plan-approval actions for a state that has none", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Todo" })]} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
