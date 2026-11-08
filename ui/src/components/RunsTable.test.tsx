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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "acme/widgets",
    branchName: "fix/bug",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
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

  it("renders the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText(/No runs found/i)).toBeDefined();
  });

  it("renders a row per run with issue title, repo and PR number", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to the linear identifier when there is no issue title", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is no title or identifier", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an em-dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("does not render the external Linear link when there is no issue url", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("renders the external Linear link when an issue url is present", () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/ENG-1");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("stops propagation when the external Linear link is clicked, so it does not navigate the row link", async () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear");
    const stopPropagation = vi.fn();
    // Dispatch directly so we can observe stopPropagation being invoked on the event.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "stopPropagation", { value: stopPropagation });
    link.dispatchEvent(event);
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("shows Approve/Reject plan actions for AwaitingPlanApproval state and calls the api", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    const approveBtn = screen.getByTitle("Approve Plan");
    const rejectBtn = screen.getByTitle("Reject Plan");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    await userEvent.click(approveBtn);
    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
  });

  it("calls onAction after a successful approve action", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("swallows action errors and does not call onAction", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    // Give the rejected promise a tick to settle.
    await vi.waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("calls rejectPlan when the reject button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);
    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
  });

  it("shows Approve & Complete action for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);
    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
  });

  it("shows a pause action for active-category states and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);
    const btn = screen.getByTitle("Pause Run");
    await userEvent.click(btn);
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("does not show a pause action for a non-active state", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows a resume action for AIBlocked and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "AIBlocked" })]);
    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a resume action for HumanClarificationNeeded", () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("renders a link to the run detail page", () => {
    renderTable([makeRun()]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-1")).toBe(true);
  });
});
