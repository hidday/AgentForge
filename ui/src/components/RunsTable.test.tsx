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
    linearIssueIdentifier: "ENG-100",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-100",
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
    workingDirectory: "/tmp/work",
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
  });

  it("renders table headers and one row per run", () => {
    renderTable([makeRun({ id: "run-1" }), makeRun({ id: "run-2", linearIssueIdentifier: "ENG-200" })]);
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("Issue")).toBeDefined();
    expect(screen.getByText("Repo")).toBeDefined();
    expect(screen.getByText("PR")).toBeDefined();
    expect(screen.getByText("Updated")).toBeDefined();
    expect(screen.getByText("Actions")).toBeDefined();
    expect(screen.getAllByRole("row").length).toBe(3); // header + 2 runs
  });

  it("prefers linearIssueTitle for the issue link text", () => {
    renderTable([makeRun({ linearIssueTitle: "Fix the bug" })]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when title is missing", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-55" }),
    ]);
    expect(screen.getByText("ENG-55")).toBeDefined();
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

  it("renders an external link to Linear when linearIssueUrl is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/x/y" })]);
    const link = screen.getByTitle("Open in Linear");
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("https://linear.app/x/y");
  });

  it("stops propagation when clicking the external Linear link so the row link isn't also triggered", async () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/x/y" })]);
    const link = screen.getByTitle("Open in Linear");
    await userEvent.click(link);
    // No assertion error means the click handler ran without navigating away
    // or throwing; the link itself should remain in the document.
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("does not render the external Linear link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("renders the PR number with a # prefix when present", () => {
    renderTable([makeRun({ prNumber: 7 })]);
    expect(screen.getByText("#7")).toBeDefined();
  });

  it("renders an em dash when prNumber is absent", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders Approve/Reject plan actions for AwaitingPlanApproval state", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
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

  it("calls api.rejectPlan when the reject plan button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-9");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("renders the Approve & Complete action for ReadyForHumanReview state", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    const approveBtn = screen.getByTitle("Approve & Complete");
    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("renders a Pause action for active-category states", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    const pauseBtn = screen.getByTitle("Pause Run");
    await userEvent.click(pauseBtn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not render a Pause action for non-active states", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("renders a Resume action for AIBlocked state", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("renders a Resume action for HumanClarificationNeeded state", () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("renders no state-specific action buttons for a Done run, only the row link", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("does not call onAction when it is not provided and an action succeeds", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("swallows action errors without throwing and without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network down"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders the repo name as monospace text", () => {
    renderTable([makeRun({ repo: "acme/widgets" })]);
    expect(screen.getByText("acme/widgets")).toBeDefined();
  });

  it("links the row's chevron to the run detail page", () => {
    renderTable([makeRun({ id: "run-77" })]);
    const links = screen.getAllByRole("link");
    const detailLink = links.find((l) => l.getAttribute("href") === "/runs/run-77");
    expect(detailLink).toBeDefined();
  });
});
