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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-123",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-123",
    repo: "org/repo",
    branchName: "fix/bug",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

  it("renders an empty state when there are no runs", () => {
    renderWithRouter(<RunsTable runs={[]} />);
    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders run fields: title link, repo, PR number, and state badge", () => {
    renderWithRouter(<RunsTable runs={[makeRun()]} />);

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();

    const link = screen.getByText("Fix the bug").closest("a");
    expect(link?.getAttribute("href")).toBe("/runs/run-1");
  });

  it("falls back to issue identifier then id prefix when title is missing", () => {
    renderWithRouter(
      <RunsTable
        runs={[makeRun({ linearIssueTitle: null, id: "abcdefgh12345" })]}
      />,
    );
    expect(screen.getByText("ENG-123")).toBeDefined();
  });

  it("falls back to a slice of the issue id when both title and identifier are missing", () => {
    renderWithRouter(
      <RunsTable
        runs={[
          makeRun({
            linearIssueTitle: null,
            linearIssueIdentifier: null,
            linearIssueId: "0123456789abcdef",
          }),
        ]}
      />,
    );
    expect(screen.getByText("01234567")).toBeDefined();
  });

  it("shows an em dash when there is no PR number", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ prNumber: null })]} />);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders an external Linear link only when a URL is present", () => {
    const { rerender } = renderWithRouter(<RunsTable runs={[makeRun()]} />);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows approve/reject plan actions for AwaitingPlanApproval and calls the API", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable
        runs={[makeRun({ state: "AwaitingPlanApproval" })]}
        onAction={onAction}
      />,
    );

    const approveBtn = screen.getByTitle("Approve Plan");
    const rejectBtn = screen.getByTitle("Reject Plan");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls rejectPlan when the reject button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "AwaitingPlanApproval" })]} />,
    );

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows the approve & complete action for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "ReadyForHumanReview" })]} />,
    );

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows a pause action for active-category states", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Implementing" })]} />);

    const btn = screen.getByTitle("Pause Run");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows a resume action for AIBlocked and HumanClarificationNeeded states", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    const { rerender } = renderWithRouter(
      <RunsTable runs={[makeRun({ state: "AIBlocked" })]} />,
    );
    expect(screen.getByTitle("Resume Run")).toBeDefined();
    await userEvent.click(screen.getByTitle("Resume Run"));
    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ state: "HumanClarificationNeeded" })]} />
      </MemoryRouter>,
    );
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not show plan/review/pause/resume actions for an unrelated state", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Todo" })]} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without calling onAction", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable
        runs={[makeRun({ state: "AwaitingPlanApproval" })]}
        onAction={onAction}
      />,
    );

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders multiple runs as separate rows", () => {
    renderWithRouter(
      <RunsTable
        runs={[
          makeRun({ id: "run-1", linearIssueTitle: "First" }),
          makeRun({ id: "run-2", linearIssueTitle: "Second" }),
        ]}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 rows
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
  });
});
