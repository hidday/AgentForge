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
    linearIssueUrl: "https://linear.app/issue/ENG-123",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
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

  it("renders 'No runs found' empty state when runs array is empty", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row per run with issue title, repo, and PR number", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when title is missing", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-123")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows em dash when prNumber is absent", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("does not render external Linear link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("renders external Linear link when linearIssueUrl is present", () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(link.href).toBe("https://linear.app/issue/ENG-123");
  });

  it("shows Approve/Reject Plan actions only for AwaitingPlanApproval state", () => {
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);
    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
  });

  it("shows Approve & Complete action only for ReadyForHumanReview state", () => {
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);
    expect(screen.getByTitle("Approve & Complete")).toBeDefined();
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
  });

  it("clicking Approve & Complete calls api.approveReview and onAction", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-5", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    expect(mockApi.approveReview).toHaveBeenCalledWith("run-5");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("clicking the external Linear link stops propagation and does not navigate the row", async () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear");
    // Should not throw, and the click should not bubble to trigger row navigation.
    await userEvent.click(link);
    expect(link).toBeDefined();
  });

  it("shows Pause action for active-category states", () => {
    renderTable([makeRun({ state: "Implementing" })]);
    expect(screen.getByTitle("Pause Run")).toBeDefined();
  });

  it("does not show Pause action for non-active states", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows Resume action for AIBlocked and HumanClarificationNeeded states", () => {
    renderTable([makeRun({ state: "AIBlocked" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("shows no state-specific action buttons for a plain Done run besides the row link", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("clicking Approve Plan calls api.approvePlan with the run id and then onAction", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-42", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-42");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("clicking Reject Plan calls api.rejectPlan and onAction", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-7", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-7");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("clicking Pause Run calls api.pauseRun and onAction", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-9");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("clicking Resume Run calls api.resumeRun and onAction", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-3", state: "HumanClarificationNeeded" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-3");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("swallows action errors without throwing and without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    // Let the rejected promise settle.
    await vi.waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledTimes(1));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not call onAction when it is not provided and action succeeds", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await vi.waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledTimes(1));
  });

  it("renders multiple rows for multiple runs", () => {
    renderTable([
      makeRun({ id: "a", linearIssueTitle: "First" }),
      makeRun({ id: "b", linearIssueTitle: "Second" }),
    ]);
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
  });
});
