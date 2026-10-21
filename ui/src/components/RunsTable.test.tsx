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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-issue-id-12345",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
    repo: "my-org/my-repo",
    branchName: null,
    prNumber: 42,
    state: "AwaitingPlanApproval",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
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

  it("renders a row per run with issue title, repo, and PR number", () => {
    renderWithRouter(
      <RunsTable
        runs={[
          makeRun({ id: "r1", linearIssueTitle: "First issue", prNumber: 7 }),
          makeRun({ id: "r2", linearIssueTitle: "Second issue", prNumber: null }),
        ]}
      />,
    );
    expect(screen.getByText("First issue")).toBeDefined();
    expect(screen.getByText("Second issue")).toBeDefined();
    expect(screen.getByText("#7")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getAllByText("my-org/my-repo")).toHaveLength(2);
  });

  it("falls back to the identifier when title is missing", () => {
    renderWithRouter(
      <RunsTable
        runs={[
          makeRun({ id: "r1", linearIssueTitle: null, linearIssueIdentifier: "LIN-9" }),
        ]}
      />,
    );
    expect(screen.getByText("LIN-9")).toBeDefined();
  });

  it("falls back to a truncated issue id when title and identifier are missing", () => {
    renderWithRouter(
      <RunsTable
        runs={[
          makeRun({
            id: "r2",
            linearIssueTitle: null,
            linearIssueIdentifier: null,
            linearIssueId: "abcdefgh12345",
          }),
        ]}
      />,
    );
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("links the issue title to the run detail page", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ id: "run-42" })]} />);
    const link = screen.getByRole("link", { name: "Fix the thing" });
    expect(link.getAttribute("href")).toBe("/runs/run-42");
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    renderWithRouter(<RunsTable runs={[makeRun()]} />);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/LIN-1");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("stops the external Linear link's click from bubbling up to an ancestor handler", async () => {
    const user = userEvent.setup();
    const parentClick = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={parentClick}>
          <RunsTable runs={[makeRun()]} />
        </div>
      </MemoryRouter>,
    );

    await user.click(screen.getByTitle("Open in Linear"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("does not render the external Linear link when linearIssueUrl is null", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ linearIssueUrl: null })]} />);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject Plan actions for AwaitingPlanApproval and calls the api", async () => {
    const user = userEvent.setup();
    mockApi.approvePlan.mockResolvedValue(undefined);
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable
        runs={[makeRun({ id: "run-1", state: "AwaitingPlanApproval" })]}
        onAction={onAction}
      />,
    );

    await user.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("calls rejectPlan when Reject Plan is clicked", async () => {
    const user = userEvent.setup();
    mockApi.rejectPlan.mockResolvedValue(undefined);
    renderWithRouter(
      <RunsTable runs={[makeRun({ id: "run-2", state: "AwaitingPlanApproval" })]} />,
    );
    await user.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-2");
  });

  it("shows an Approve & Complete action for ReadyForHumanReview", async () => {
    const user = userEvent.setup();
    mockApi.approveReview.mockResolvedValue(undefined);
    renderWithRouter(
      <RunsTable runs={[makeRun({ id: "run-3", state: "ReadyForHumanReview" })]} />,
    );
    await user.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-3");
  });

  it("shows a Pause action for an active-category state", async () => {
    const user = userEvent.setup();
    mockApi.pauseRun.mockResolvedValue(undefined);
    renderWithRouter(
      <RunsTable runs={[makeRun({ id: "run-4", state: "Implementing" })]} />,
    );
    const pauseButton = screen.getByTitle("Pause Run");
    await user.click(pauseButton);
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-4");
  });

  it("shows a Resume action for AIBlocked and HumanClarificationNeeded states", async () => {
    const user = userEvent.setup();
    mockApi.resumeRun.mockResolvedValue(undefined);
    renderWithRouter(
      <RunsTable runs={[makeRun({ id: "run-5", state: "AIBlocked" })]} />,
    );
    await user.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-5");
  });

  it("does not show any state-specific action buttons for a terminal state", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ id: "run-6", state: "Done" })]} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without crashing and without calling onAction", async () => {
    const user = userEvent.setup();
    mockApi.approvePlan.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderWithRouter(
      <RunsTable
        runs={[makeRun({ id: "run-7", state: "AwaitingPlanApproval" })]}
        onAction={onAction}
      />,
    );
    await user.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("links the chevron icon to the run detail page", () => {
    renderWithRouter(<RunsTable runs={[makeRun({ id: "run-8" })]} />);
    const links = screen.getAllByRole("link");
    const detailLink = links.find((l) => l.getAttribute("href") === "/runs/run-8");
    expect(detailLink).toBeDefined();
  });
});
