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
    linearIssueId: "issue-1234567890",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix-branch",
    prNumber: 42,
    state: "Done",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
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

  it("renders a row per run with repo, PR number and relative time", () => {
    renderTable([makeRun({})]);
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("shows an em-dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("prefers linearIssueTitle for the issue link label", () => {
    renderTable([makeRun({ linearIssueTitle: "My Title" })]);
    expect(screen.getByRole("link", { name: "My Title" })).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when title is missing", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" }),
    ]);
    expect(screen.getByRole("link", { name: "ENG-99" })).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefghij",
      }),
    ]);
    expect(screen.getByRole("link", { name: "abcdefgh" })).toBeDefined();
  });

  it("links the issue row to the run detail page", () => {
    renderTable([makeRun({ id: "run-42" })]);
    const link = screen.getByRole("link", { name: "Fix the bug" });
    expect(link.getAttribute("href")).toBe("/runs/run-42");
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/x/y" })]);
    const external = screen.getByTitle("Open in Linear");
    expect(external.getAttribute("href")).toBe("https://linear.app/x/y");
  });

  it("omits the external Linear link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject plan buttons only for AwaitingPlanApproval", () => {
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);
    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
  });

  it("shows Approve & Complete only for ReadyForHumanReview", () => {
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);
    expect(screen.getByTitle("Approve & Complete")).toBeDefined();
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
  });

  it("shows a Pause button for active-category states", () => {
    renderTable([makeRun({ state: "Implementing" })]);
    expect(screen.getByTitle("Pause Run")).toBeDefined();
  });

  it("does not show a Pause button for non-active states", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows a Resume button for AIBlocked", () => {
    renderTable([makeRun({ state: "AIBlocked" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("shows a Resume button for HumanClarificationNeeded", () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("shows no state-specific action buttons for a terminal Done state", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("always renders the chevron link to the run detail page", () => {
    renderTable([makeRun({ id: "run-7", state: "Done" })]);
    const links = screen.getAllByRole("link");
    const chevronLink = links.find(
      (l) => l.getAttribute("href") === "/runs/run-7" && l !== screen.getByRole("link", { name: "Fix the bug" }),
    );
    expect(chevronLink).toBeDefined();
  });

  it("calls api.approvePlan and onAction when Approve Plan is clicked", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-1", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.rejectPlan when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    renderTable([makeRun({ id: "run-2", state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-2");
    });
  });

  it("calls api.approveReview when Approve & Complete is clicked", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    renderTable([makeRun({ id: "run-3", state: "ReadyForHumanReview" })]);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-3");
    });
  });

  it("calls api.pauseRun when Pause Run is clicked", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-4", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-4");
    });
  });

  it("calls api.resumeRun when Resume Run is clicked", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-5", state: "AIBlocked" })]);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-5");
    });
  });

  it("does not call onAction and does not throw when the action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-6", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-6");
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback supplied", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-8", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-8");
    });
  });

  it("clicking the external Linear link does not trigger row navigation side effects", async () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/x/y" })]);
    const external = screen.getByTitle("Open in Linear");
    // Should not throw and should remain a plain anchor with target=_blank
    expect(external.getAttribute("target")).toBe("_blank");
    await userEvent.click(external);
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
  });

  it("renders multiple runs in a single table", () => {
    renderTable([
      makeRun({ id: "run-a", repo: "org/repo-a" }),
      makeRun({ id: "run-b", repo: "org/repo-b" }),
    ]);
    expect(screen.getByText("org/repo-a")).toBeDefined();
    expect(screen.getByText("org/repo-b")).toBeDefined();
  });
});
