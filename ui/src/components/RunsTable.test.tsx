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
    linearIssueId: "li-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "agentforge",
    branchName: null,
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/repo",
    latestArtifactVersion: 1,
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

  it("renders an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders the issue title, repo, and PR number", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Add login")).toBeDefined();
    expect(screen.getByText("agentforge")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to the identifier, then a truncated issue id, when there is no title", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier exist", () => {
    renderTable([makeRun({ linearIssueTitle: null, linearIssueIdentifier: null })]);
    expect(screen.getByText("li-12345")).toBeDefined();
  });

  it("shows a dash for PR number when the run has no PR yet", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("calling the external Linear link's click handler does not throw", async () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear");

    await expect(userEvent.click(link)).resolves.toBeUndefined();
  });

  it("shows the external Linear link only when a URL is present", () => {
    const { rerender } = renderTable([makeRun()]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows approve/reject plan actions for AwaitingPlanApproval and calls the API", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("calls rejectPlan when the reject button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
  });

  it("shows the approve-and-complete action for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
  });

  it("shows a pause action for an active-category state", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a resume action for AIBlocked and HumanClarificationNeeded", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "AIBlocked" })]);
    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
  });

  it("does not call onAction when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("fail"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows no action buttons for a terminal Done state besides navigation", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
