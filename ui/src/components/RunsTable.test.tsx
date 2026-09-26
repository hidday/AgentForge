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

function makeRun(overrides: Partial<Run> & { id: string; state: string }): Run {
  return {
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  } as Run;
}

function renderWithRouter(ui: React.ReactElement) {
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

  it("renders a row per run with issue title, repo, and PR number", () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo", prNumber: 42 }),
    ];
    renderWithRouter(<RunsTable runs={runs} />);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("renders an em-dash when there is no PR number", () => {
    const runs = [makeRun({ id: "r1", state: "Todo", prNumber: null })];
    renderWithRouter(<RunsTable runs={runs} />);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the identifier, then the truncated linear issue id, when there's no title", () => {
    const runs = [
      makeRun({
        id: "r1",
        state: "Todo",
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-99",
      }),
    ];
    renderWithRouter(<RunsTable runs={runs} />);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("renders an external link icon when linearIssueUrl is present", () => {
    const runs = [
      makeRun({ id: "r1", state: "Todo", linearIssueUrl: "https://linear.app/issue/1" }),
    ];
    renderWithRouter(<RunsTable runs={runs} />);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/1");
  });

  it("shows Approve/Reject buttons for AwaitingPlanApproval and calls the API on click", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    renderWithRouter(<RunsTable runs={runs} onAction={onAction} />);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalled();
  });

  it("calls rejectPlan when the Reject Plan button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    renderWithRouter(<RunsTable runs={runs} />);

    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
  });

  it("shows the Approve & Complete button for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const runs = [makeRun({ id: "r1", state: "ReadyForHumanReview" })];
    renderWithRouter(<RunsTable runs={runs} />);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
  });

  it("shows the Pause button for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const runs = [makeRun({ id: "r1", state: "Implementing" })];
    renderWithRouter(<RunsTable runs={runs} />);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
  });

  it("shows the Resume button for AIBlocked and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const runs = [makeRun({ id: "r1", state: "AIBlocked" })];
    renderWithRouter(<RunsTable runs={runs} />);

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
  });

  it("does not call onAction when the API call rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("fail"));
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "Implementing" })];
    renderWithRouter(<RunsTable runs={runs} onAction={onAction} />);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not render action buttons for a state with no available actions", () => {
    const runs = [makeRun({ id: "r1", state: "Done" })];
    renderWithRouter(<RunsTable runs={runs} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
