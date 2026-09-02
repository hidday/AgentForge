import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-123",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the login bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-123",
    repo: "acme/webapp",
    branchName: "fix/login",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: "claude",
    executorRuntime: "claude",
    reviewerRuntime: "claude",
    remediationRuntime: null,
    workingDirectory: "/work",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
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
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders one row per run with issue title, repo and PR number", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the login bug")).toBeDefined();
    expect(screen.getByText("acme/webapp")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("links the issue title to the run detail page", () => {
    renderTable([makeRun({ id: "run-42" })]);
    const link = screen.getByText("Fix the login bug").closest("a");
    expect(link?.getAttribute("href")).toBe("/runs/run-42");
  });

  it("shows an external Linear link when linearIssueUrl is present, and clicking it calls stopPropagation on the event", async () => {
    renderTable([makeRun()]);
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe(
      "https://linear.app/team/issue/ENG-123",
    );
    expect(externalLink.getAttribute("target")).toBe("_blank");

    const stopPropagationSpy = vi.spyOn(Event.prototype, "stopPropagation");
    await userEvent.click(externalLink);
    expect(stopPropagationSpy).toHaveBeenCalled();
    stopPropagationSpy.mockRestore();
  });

  it("omits the external Linear link when linearIssueUrl is null", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("falls back to the identifier, then a truncated id, when no title is present", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }),
    ]);
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when neither title nor identifier exist", () => {
    renderTable([
      makeRun({
        id: "r1",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefghijklmnop",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an em-dash for PR number when there is no PR yet", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders a relative time for the updatedAt column", () => {
    renderTable([makeRun({ updatedAt: new Date(Date.now() - 30_000).toISOString() })]);
    expect(screen.getByText(/just now|ago/)).toBeDefined();
  });

  it("shows Approve/Reject Plan actions for AwaitingPlanApproval, and calls the API on click", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-1", state: "AwaitingPlanApproval" })], onAction);

    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
    // Not an active-category state, so no pause button
    expect(screen.queryByTitle("Pause Run")).toBeNull();

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls rejectPlan when the Reject Plan button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    renderTable([makeRun({ id: "run-2", state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-2");
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview, and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    renderTable([makeRun({ id: "run-3", state: "ReadyForHumanReview" })]);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-3");
    });
  });

  it("shows a Pause button for active-category states, and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    renderTable([makeRun({ id: "run-4", state: "Implementing" })]);

    const btn = screen.getByTitle("Pause Run");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-4");
    });
  });

  it("shows a Resume button for AIBlocked/HumanClarificationNeeded, and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    renderTable([makeRun({ id: "run-5", state: "AIBlocked" })]);

    const btn = screen.getByTitle("Resume Run");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-5");
    });
  });

  it("does not call onAction and does not throw when the action promise rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-6", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    // Give the rejected promise a tick to settle.
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("always renders a chevron link to the run detail page", () => {
    renderTable([makeRun({ id: "run-7", state: "Done" })]);
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href") === "/runs/run-7");
    expect(links.length).toBeGreaterThan(0);
  });
});
