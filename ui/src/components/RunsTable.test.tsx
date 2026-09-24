import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";
import { RunsTable } from "./RunsTable.tsx";

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
    id: "run-12345678",
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-101",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "feat/fix",
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
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row per run with issue title, repo, PR fallback, and state badge", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("renders many rows", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "First" }),
      makeRun({ id: "r2", linearIssueTitle: "Second" }),
      makeRun({ id: "r3", linearIssueTitle: "Third" }),
    ];
    renderTable(runs);
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
    expect(screen.getByText("Third")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when there is no title, and to a truncated id when neither exists", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueTitle: null, linearIssueIdentifier: "ENG-202" }),
      makeRun({
        id: "r2",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh-ijkl",
      }),
    ]);
    expect(screen.getByText("ENG-202")).toBeDefined();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows the PR number when present", () => {
    renderTable([makeRun({ prNumber: 42 })]);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("shows an external Linear link only when linearIssueUrl is set", () => {
    const { rerender } = renderTable([
      makeRun({ id: "r1", linearIssueUrl: "https://linear.app/issue/r1" }),
    ]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/r1");

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ id: "r2", linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("stops the click on the external Linear link from bubbling up to the row", async () => {
    renderTable([
      makeRun({ id: "r1", linearIssueUrl: "https://linear.app/issue/r1" }),
    ]);
    const link = screen.getByTitle("Open in Linear");
    const stopPropagation = vi.fn();
    // Dispatch a click that we can inspect for stopPropagation having been
    // invoked by the handler, without triggering a real navigation.
    await userEvent.click(link);
    // A follow-up native event asserts the handler itself calls
    // stopPropagation on the event it receives.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "stopPropagation", { value: stopPropagation });
    link.dispatchEvent(event);
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("links the issue title and chevron to the run detail page", () => {
    renderTable([makeRun({ id: "run-xyz" })]);
    const issueLink = screen.getByRole("link", { name: "Fix the thing" });
    expect(issueLink.getAttribute("href")).toBe("/runs/run-xyz");
  });

  it("shows approve/reject plan actions for AwaitingPlanApproval and calls the API + onAction", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("calls rejectPlan and onAction when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows a Pause action for active-category states and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows a Resume action for AIBlocked and HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable(
      [
        makeRun({ id: "r1", state: "AIBlocked" }),
        makeRun({ id: "r2", state: "HumanClarificationNeeded" }),
      ],
      onAction,
    );

    const resumeButtons = screen.getAllByTitle("Resume Run");
    expect(resumeButtons.length).toBe(2);
    await userEvent.click(resumeButtons[0]);
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not render any state-specific action buttons for Done or Todo", () => {
    renderTable([makeRun({ id: "r1", state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not throw when onAction is not provided", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "r1", state: "Implementing" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
  });
});
