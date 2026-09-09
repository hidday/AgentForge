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

import { api } from "@/api/client.ts";
import { RunsTable } from "./RunsTable.tsx";

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
    linearIssueId: "issue-1234567",
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
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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
  });

  it("shows an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders run details: issue title, repo, PR number placeholder, and state badge", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("shows the PR number when present", () => {
    renderTable([makeRun({ prNumber: 42 })]);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to identifier, then a truncated issue id, when title is missing", () => {
    renderTable([makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-9" })]);
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when both title and identifier are missing", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "abcdefgh12345" }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an external Linear link only when linearIssueUrl is present", () => {
    const { rerender } = renderTable([makeRun({ linearIssueUrl: "https://linear.app/x" })]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("stops the Linear link click from propagating to the row", async () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/x" })]);
    const link = screen.getByTitle("Open in Linear");
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagationSpy = vi.spyOn(clickEvent, "stopPropagation");
    link.dispatchEvent(clickEvent);
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("shows Approve/Reject actions for AwaitingPlanApproval and calls the API on click", async () => {
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalled();
  });

  it("calls rejectPlan when the reject action is clicked", async () => {
    const onAction = vi.fn();
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalled();
  });

  it("shows Approve & Complete action for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalled();
  });

  it("shows a Pause action for active-category states", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalled();
  });

  it("shows a Resume action for AIBlocked and HumanClarificationNeeded", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalled();
  });

  it("does not throw and still calls onAction is skipped when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not require an onAction callback", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
  });

  it("renders a row link to the run detail page", () => {
    renderTable([makeRun()]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-1")).toBe(true);
  });
});
