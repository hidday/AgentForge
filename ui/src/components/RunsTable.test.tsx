import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/issue-1",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Run;
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

  it("shows an empty state and no table when there are no runs", () => {
    renderTable([]);

    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row per run with issue title, repo, PR number, and a state badge", () => {
    const runs = [
      makeRun({
        id: "run-1",
        linearIssueTitle: "Fix the bug",
        repo: "acme/widgets",
        prNumber: 42,
        state: "Implementing",
      }),
      makeRun({
        id: "run-2",
        linearIssueTitle: "Add feature",
        linearIssueIdentifier: "ENG-2",
        repo: "acme/other",
        prNumber: null,
        state: "Done",
        linearIssueUrl: null,
      }),
    ];
    renderTable(runs);

    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("Add feature")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("acme/other")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();

    // State badges render with their formatted labels.
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();

    // Header row + 2 data rows.
    expect(screen.getAllByRole("row").length).toBe(3);
  });

  it("falls back to the issue identifier when no title is present", () => {
    renderTable([
      makeRun({ id: "run-3", linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }),
    ]);
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier is present", () => {
    renderTable([
      makeRun({
        id: "run-4",
        linearIssueId: "abcdef1234567890",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
      }),
    ]);
    expect(screen.getByText("abcdef12")).toBeDefined();
  });

  it("links each run row to its detail page", () => {
    renderTable([makeRun({ id: "run-42" })]);

    const detailLinks = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href") === "/runs/run-42");
    // Both the issue title and the chevron link point at the run.
    expect(detailLinks.length).toBe(2);
  });

  it("renders an external Linear link that opens in a new tab and does not navigate the row", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/issue-1" })]);

    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe("https://linear.app/issue-1");
    expect(externalLink.getAttribute("target")).toBe("_blank");
  });

  it("omits the external Linear link when the run has no linearIssueUrl", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows approve/reject plan buttons for AwaitingPlanApproval and calls the API on approve", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue({});

    renderTable([makeRun({ id: "run-5", state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    expect(screen.getByTitle("Reject Plan")).toBeDefined();

    await user.click(approveBtn);

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-5");
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("calls rejectPlan when the reject button is clicked", async () => {
    const user = userEvent.setup();
    mockApi.rejectPlan.mockResolvedValue({});

    renderTable([makeRun({ id: "run-5b", state: "AwaitingPlanApproval" })]);

    await user.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-5b");
  });

  it("shows an approve & complete button for ReadyForHumanReview and calls approveReview", async () => {
    const user = userEvent.setup();
    mockApi.approveReview.mockResolvedValue({});

    renderTable([makeRun({ id: "run-6", state: "ReadyForHumanReview" })]);

    await user.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-6");
  });

  it("shows a pause button for active-category states and calls pauseRun", async () => {
    const user = userEvent.setup();
    mockApi.pauseRun.mockResolvedValue({});

    renderTable([makeRun({ id: "run-7", state: "Implementing" })]);

    await user.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-7");
  });

  it("does not show a pause button for a non-active state", () => {
    renderTable([makeRun({ id: "run-7b", state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows a resume button for AIBlocked and HumanClarificationNeeded states", async () => {
    const user = userEvent.setup();
    mockApi.resumeRun.mockResolvedValue({});

    renderTable([
      makeRun({ id: "run-8", state: "AIBlocked" }),
      makeRun({ id: "run-9", state: "HumanClarificationNeeded" }),
    ]);

    const resumeButtons = screen.getAllByTitle("Resume Run");
    expect(resumeButtons.length).toBe(2);

    await user.click(resumeButtons[0]);
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-8");
  });

  it("swallows action errors and does not call onAction when the API call rejects", async () => {
    const user = userEvent.setup();
    mockApi.pauseRun.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();

    renderTable([makeRun({ id: "run-10", state: "Implementing" })], onAction);

    await user.click(screen.getByTitle("Pause Run"));

    await waitFor(() => expect(mockApi.pauseRun).toHaveBeenCalledOnce());
    expect(onAction).not.toHaveBeenCalled();
  });
});
