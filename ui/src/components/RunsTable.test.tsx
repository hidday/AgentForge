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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-123",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-123",
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
    workingDirectory: "/tmp/acme",
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

  it("renders the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row with issue title, repo, PR number, and state badge", () => {
    renderTable([makeRun()]);
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    // StateBadge formats "Implementing" state name
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when title is missing", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-123")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are both missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an em-dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders a link to open the Linear issue when a URL is present", () => {
    renderTable([makeRun()]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe(
      "https://linear.app/team/issue/ENG-123",
    );
  });

  it("stops the click on the Linear external link from propagating, without triggering row actions", async () => {
    const onAction = vi.fn();
    renderTable([makeRun()], onAction);
    const link = screen.getByTitle("Open in Linear");

    await userEvent.click(link);

    // The link's own onClick calls stopPropagation; nothing else on the row
    // should have reacted to the click (no action API calls triggered).
    expect(onAction).not.toHaveBeenCalled();
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
    expect(link.getAttribute("href")).toBe(
      "https://linear.app/team/issue/ENG-123",
    );
  });

  it("does not render the Linear external link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("links the issue title and chevron to the run detail page", () => {
    renderTable([makeRun()]);
    const issueLink = screen.getByRole("link", { name: "Fix the bug" });
    expect(issueLink.getAttribute("href")).toBe("/runs/run-1");
  });

  it("shows Approve/Reject plan actions for AwaitingPlanApproval state and calls the API", async () => {
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue({ ok: true, run: makeRun() });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    const rejectBtn = screen.getByTitle("Reject Plan");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls rejectPlan when the Reject Plan button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, run: makeRun() });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows Approve & Complete action for ReadyForHumanReview state", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, run: makeRun() });
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);

    const approveBtn = screen.getByTitle("Approve & Complete");
    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows a Pause action for active-category states", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true, run: makeRun() });
    renderTable([makeRun({ state: "Implementing" })]);

    const pauseBtn = screen.getByTitle("Pause Run");
    await userEvent.click(pauseBtn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("does not show a Pause action for a non-active state", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows a Resume action for AIBlocked state and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true, run: makeRun() });
    renderTable([makeRun({ state: "AIBlocked" })]);

    const resumeBtn = screen.getByTitle("Resume Run");
    await userEvent.click(resumeBtn);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows a Resume action for HumanClarificationNeeded state", () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not call onAction and does not throw when the API action rejects", async () => {
    const onAction = vi.fn();
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders the chevron link to the run detail page without requiring onAction", () => {
    renderTable([makeRun()]);
    const links = screen.getAllByRole("link");
    const chevronLink = links.find(
      (l) => l.getAttribute("href") === "/runs/run-1" && l.textContent === "",
    );
    expect(chevronLink).toBeDefined();
  });

  it("renders multiple runs as multiple rows", () => {
    renderTable([
      makeRun({ id: "run-1", linearIssueTitle: "First run" }),
      makeRun({ id: "run-2", linearIssueTitle: "Second run" }),
    ]);
    expect(screen.getByText("First run")).toBeDefined();
    expect(screen.getByText("Second run")).toBeDefined();
  });
});
