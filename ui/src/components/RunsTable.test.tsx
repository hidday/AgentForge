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
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithRouter(children: React.ReactNode) {
  return render(<MemoryRouter>{children}</MemoryRouter>);
}

describe("RunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty state when there are no runs", () => {
    renderWithRouter(<RunsTable runs={[]} />);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders table headers and run row data", () => {
    renderWithRouter(<RunsTable runs={[makeRun()]} />);
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("Issue")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
  });

  it("falls back to identifier then issue id prefix for the issue link label", () => {
    renderWithRouter(
      <RunsTable
        runs={[
          makeRun({ id: "r1", linearIssueTitle: null, linearIssueIdentifier: "ENG-99" }),
          makeRun({
            id: "r2",
            linearIssueTitle: null,
            linearIssueIdentifier: null,
            linearIssueId: "abcdefgh12345",
          }),
        ]}
      />,
    );
    expect(screen.getByText("ENG-99")).toBeDefined();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an external Linear link icon only when linearIssueUrl is present", () => {
    renderWithRouter(
      <RunsTable runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]} />,
    );
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("does not show the Linear link icon when linearIssueUrl is null", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ linearIssueUrl: null })]} />);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows the PR number when present and a dash otherwise", () => {
    renderWithRouter(
      <RunsTable
        runs={[makeRun({ id: "r1", prNumber: 42 }), makeRun({ id: "r2", prNumber: null })]}
      />,
    );
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("shows Approve/Reject plan buttons for AwaitingPlanApproval and calls the API", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "AwaitingPlanApproval" })]} onAction={onAction} />,
    );
    const approveBtn = screen.getByTitle("Approve Plan");
    await userEvent.click(approveBtn);
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("reject plan button calls api.rejectPlan", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "AwaitingPlanApproval" })]} onAction={onAction} />,
    );
    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows Approve & Complete button for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "ReadyForHumanReview" })]} onAction={onAction} />,
    );
    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows a Pause button for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Implementing" })]} />);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a Resume button for AIBlocked/HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    renderWithRouter(<RunsTable runs={[makeRun({ state: "AIBlocked" })]} />);
    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
  });

  it("does not throw when onAction is not provided and action succeeds", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Implementing" })]} />);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
  });

  it("swallows action errors without crashing and without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable runs={[makeRun({ state: "Implementing" })]} onAction={onAction} />,
    );
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not show any action buttons for a Done run, only the chevron link", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ state: "Done" })]} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("renders a link to the run detail page", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ id: "run-42" })]} />);
    const link = screen.getByText("Fix the bug").closest("a");
    expect(link?.getAttribute("href")).toBe("/runs/run-42");
  });
});
