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
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix/thing",
    prNumber: 42,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
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
    for (const fn of Object.values(mockApi)) fn.mockResolvedValue({ ok: true });
  });

  it("shows an empty state when there are no runs", () => {
    renderWithRouter(<RunsTable runs={[]} />);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders run data: title link, repo, PR number, and a Linear link", () => {
    renderWithRouter(<RunsTable runs={[makeRun()]} />);
    const titleLink = screen.getByText("Fix the thing");
    expect(titleLink.closest("a")?.getAttribute("href")).toBe("/runs/run-1");
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    const linearLink = screen.getByTitle("Open in Linear");
    expect(linearLink.getAttribute("href")).toBe("https://linear.app/team/issue/ENG-1");
  });

  it("falls back to the identifier when title is missing", () => {
    const { unmount } = renderWithRouter(
      <RunsTable runs={[makeRun({ linearIssueTitle: null })]} />,
    );
    expect(screen.getByText("ENG-1")).toBeDefined();
    unmount();
  });

  it("falls back to the truncated issue id when both title and identifier are missing", () => {
    renderWithRouter(
      <RunsTable
        runs={[makeRun({ linearIssueTitle: null, linearIssueIdentifier: null })]}
      />,
    );
    expect(screen.getByText("issue-12")).toBeDefined();
  });

  it("shows an em-dash when there is no PR number and hides the Linear link when there's no URL", () => {
    renderWithRouter(
      <RunsTable runs={[makeRun({ prNumber: null, linearIssueUrl: null })]} />,
    );
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject actions for AwaitingPlanApproval and calls the API then onAction", async () => {
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "AwaitingPlanApproval" })]} onAction={onAction} />,
    );
    await userEvent.click(screen.getByTitle("Approve Plan"));
    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTitle("Reject Plan"));
    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledTimes(2);
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls api.approveReview", async () => {
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "ReadyForHumanReview" })]} onAction={onAction} />,
    );
    await userEvent.click(screen.getByTitle("Approve & Complete"));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("shows Pause for an active-category state and calls api.pauseRun", async () => {
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Planning" })]} />);
    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows Resume for AIBlocked/HumanClarificationNeeded and calls api.resumeRun", async () => {
    renderWithRouter(<RunsTable runs={[makeRun({ state: "AIBlocked" })]} />);
    await userEvent.click(screen.getByTitle("Resume Run"));
    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("silently swallows action errors without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "Planning" })]} onAction={onAction} />,
    );
    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback supplied", async () => {
    renderWithRouter(<RunsTable runs={[makeRun({ state: "ReadyForHumanReview" })]} />);
    await userEvent.click(screen.getByTitle("Approve & Complete"));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows no per-row action buttons for a state with no applicable actions", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Done" })]} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
