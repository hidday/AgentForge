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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(partial: Partial<Run> & { id: string; state: string }): Run {
  return {
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
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
    ...partial,
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

  it("renders issue title, repo, and PR number for a run", () => {
    const run = makeRun({ id: "r1", state: "Implementing", prNumber: 42 });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("shows an em-dash when there is no PR number", () => {
    const run = makeRun({ id: "r1", state: "Implementing", prNumber: null });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to the issue identifier, then the id prefix, when no title", () => {
    const run = makeRun({
      id: "r1",
      state: "Todo",
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-99",
    });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is present", () => {
    const withUrl = makeRun({
      id: "r1",
      state: "Todo",
      linearIssueUrl: "https://linear.app/issue/1",
    });
    const { rerender } = renderWithRouter(<RunsTable runs={[withUrl]} />);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    const withoutUrl = makeRun({ id: "r1", state: "Todo", linearIssueUrl: null });
    rerender(
      <MemoryRouter>
        <RunsTable runs={[withoutUrl]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject plan actions only for AwaitingPlanApproval and calls the right api method", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    const run = makeRun({ id: "r1", state: "AwaitingPlanApproval" });
    renderWithRouter(<RunsTable runs={[run]} onAction={onAction} />);

    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows Approve & Complete action only for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const run = makeRun({ id: "r1", state: "ReadyForHumanReview" });
    renderWithRouter(<RunsTable runs={[run]} />);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);
    expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
  });

  it("shows a Pause action for an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const run = makeRun({ id: "r1", state: "Implementing" });
    renderWithRouter(<RunsTable runs={[run]} />);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
  });

  it("shows a Resume action for AIBlocked/HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const run = makeRun({ id: "r1", state: "AIBlocked" });
    renderWithRouter(<RunsTable runs={[run]} />);

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
  });

  it("does not call onAction and does not throw when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    const run = makeRun({ id: "r1", state: "Implementing" });
    renderWithRouter(<RunsTable runs={[run]} onAction={onAction} />);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows no action icons for a terminal state like Done", () => {
    const run = makeRun({ id: "r1", state: "Done" });
    renderWithRouter(<RunsTable runs={[run]} />);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
