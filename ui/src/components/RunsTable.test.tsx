import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
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

function makeRun(overrides: Partial<Run> & { id: string; state: string }): Run {
  return {
    id: overrides.id,
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: overrides.state,
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

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("RunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no runs", () => {
    renderWithRouter(<RunsTable runs={[]} />);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders run details: title, repo, PR placeholder, and state badge", () => {
    const run = makeRun({ id: "r1", state: "Todo" });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("falls back to the issue identifier when no title is set", () => {
    const run = makeRun({
      id: "r1",
      state: "Todo",
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-42",
    });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByText("ENG-42")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier are set", () => {
    const run = makeRun({
      id: "r1",
      state: "Todo",
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefgh12345",
    });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders the PR number when present", () => {
    const run = makeRun({ id: "r1", state: "Todo", prNumber: 42 });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    const run = makeRun({
      id: "r1",
      state: "Todo",
      linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    });
    renderWithRouter(<RunsTable runs={[run]} />);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/team/issue/ENG-1");
  });

  it("does not render an external Linear link when linearIssueUrl is absent", () => {
    const run = makeRun({ id: "r1", state: "Todo", linearIssueUrl: null });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject actions and calls api.approvePlan on approve click", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    const run = makeRun({ id: "r1", state: "AwaitingPlanApproval" });
    renderWithRouter(<RunsTable runs={[run]} onAction={onAction} />);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
    await screen.findByText("Fix the thing"); // still rendered, no crash
    expect(onAction).toHaveBeenCalled();
  });

  it("calls api.rejectPlan when reject action is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    const run = makeRun({ id: "r1", state: "AwaitingPlanApproval" });
    renderWithRouter(<RunsTable runs={[run]} />);

    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
  });

  it("shows the Approve & Complete action for ReadyForHumanReview and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const run = makeRun({ id: "r1", state: "ReadyForHumanReview" });
    renderWithRouter(<RunsTable runs={[run]} />);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
  });

  it("shows the Pause action for an active-category state and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    const run = makeRun({ id: "r1", state: "Planning" });
    renderWithRouter(<RunsTable runs={[run]} />);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
  });

  it("shows the Resume action for AIBlocked and calls api.resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    const run = makeRun({ id: "r1", state: "AIBlocked" });
    renderWithRouter(<RunsTable runs={[run]} />);

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
  });

  it("shows the Resume action for HumanClarificationNeeded", () => {
    const run = makeRun({ id: "r1", state: "HumanClarificationNeeded" });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not render any quick-action buttons for a Done run", () => {
    const run = makeRun({ id: "r1", state: "Done" });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("does not call onAction (and does not throw) when the api call fails", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    const run = makeRun({ id: "r1", state: "AwaitingPlanApproval" });
    renderWithRouter(<RunsTable runs={[run]} onAction={onAction} />);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders multiple runs", () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo", linearIssueTitle: "First" }),
      makeRun({ id: "r2", state: "Done", linearIssueTitle: "Second" }),
    ];
    renderWithRouter(<RunsTable runs={runs} />);
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
  });
});
