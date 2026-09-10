import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunsTable } from "./RunsTable";
import { api, type Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client.ts")>();
  return {
    ...actual,
    api: {
      approvePlan: vi.fn(),
      rejectPlan: vi.fn(),
      approveReview: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
    },
  };
});

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "issue-1234567",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: null,
    prNumber: 42,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    vi.mocked(api.approvePlan).mockReset().mockResolvedValue({ ok: true, state: "Implementing" });
    vi.mocked(api.rejectPlan).mockReset().mockResolvedValue({ ok: true, state: "Planning" });
    vi.mocked(api.approveReview).mockReset().mockResolvedValue({ ok: true, state: "Done" });
    vi.mocked(api.pauseRun).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(api.resumeRun).mockReset().mockResolvedValue({ ok: true });
  });

  it("renders an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders run details in each row", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to the issue identifier when no title is set", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier is set", () => {
    renderTable([makeRun({ linearIssueTitle: null, linearIssueIdentifier: null })]);
    expect(screen.getByText("issue-12")).toBeDefined();
  });

  it("shows an em dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("links to the Linear issue when a url is present", () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/ENG-1");
  });

  it("stops the Linear link click from bubbling to the row", () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    link.dispatchEvent(event);
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("omits the Linear link when no url is present", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows approve/reject actions for a run awaiting plan approval", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);
    fireEvent.click(screen.getByTitle("Approve Plan"));
    await waitFor(() => expect(api.approvePlan).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(onAction).toHaveBeenCalled());
  });

  it("rejects a plan from the table row", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);
    fireEvent.click(screen.getByTitle("Reject Plan"));
    await waitFor(() => expect(api.rejectPlan).toHaveBeenCalledWith("r1"));
  });

  it("shows an approve & complete action for a run ready for human review", async () => {
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);
    fireEvent.click(screen.getByTitle("Approve & Complete"));
    await waitFor(() => expect(api.approveReview).toHaveBeenCalledWith("r1"));
  });

  it("shows a pause action for an active run", async () => {
    renderTable([makeRun({ state: "Implementing" })]);
    fireEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalledWith("r1"));
  });

  it("shows a resume action for a blocked run", async () => {
    renderTable([makeRun({ state: "AIBlocked" })]);
    fireEvent.click(screen.getByTitle("Resume Run"));
    await waitFor(() => expect(api.resumeRun).toHaveBeenCalledWith("r1"));
  });

  it("shows a resume action for a run needing human clarification", async () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    fireEvent.click(screen.getByTitle("Resume Run"));
    await waitFor(() => expect(api.resumeRun).toHaveBeenCalledWith("r1"));
  });

  it("swallows action errors instead of throwing", async () => {
    vi.mocked(api.pauseRun).mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);
    fireEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => expect(api.pauseRun).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows no state-specific action buttons for a Done run", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });
});
