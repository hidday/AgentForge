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
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: 42,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/x",
    latestArtifactVersion: 0,
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

  it("prefers linearIssueTitle, falling back to identifier, then a truncated id", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueTitle: "Has a title" }),
      makeRun({
        id: "r2",
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-99",
      }),
      makeRun({
        id: "r3",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);

    expect(screen.getByText("Has a title")).toBeDefined();
    expect(screen.getByText("ENG-99")).toBeDefined();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is present", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueUrl: "https://linear.app/x" }),
      makeRun({ id: "r2", linearIssueUrl: null }),
    ]);
    const links = screen.getAllByTitle("Open in Linear");
    expect(links.length).toBe(1);
    expect((links[0] as HTMLAnchorElement).href).toBe("https://linear.app/x");
  });

  it("stops propagation when the external Linear link is clicked, so it doesn't bubble past the table", () => {
    renderTable([makeRun({ id: "r1", linearIssueUrl: "https://linear.app/x" })]);
    // React attaches its delegated listener on the render container itself,
    // so an ancestor listener must be registered on document (outside that
    // root) to observe whether the click actually bubbles out.
    const ancestorClickSpy = vi.fn();
    document.addEventListener("click", ancestorClickSpy);

    try {
      const link = screen.getByTitle("Open in Linear");
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(ancestorClickSpy).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", ancestorClickSpy);
    }
  });

  it("renders the PR number or an em dash when absent", () => {
    renderTable([
      makeRun({ id: "r1", prNumber: 7 }),
      makeRun({ id: "r2", prNumber: null }),
    ]);
    expect(screen.getByText("#7")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("shows approve/reject plan buttons for AwaitingPlanApproval and calls the API with the run id", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-42", state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    const rejectBtn = screen.getByTitle("Reject Plan");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-42");
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("calls rejectPlan with the run id when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    renderTable([makeRun({ id: "run-7", state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-7");
    });
  });

  it("shows an Approve & Complete button for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-9");
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a Pause button for active-category states and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-10", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-10");
    });
  });

  it("shows a Resume button for AIBlocked and HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([
      makeRun({ id: "run-11", state: "AIBlocked" }),
      makeRun({ id: "run-12", state: "HumanClarificationNeeded" }),
    ]);

    const resumeButtons = screen.getAllByTitle("Resume Run");
    expect(resumeButtons.length).toBe(2);

    await userEvent.click(resumeButtons[0]);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-11");
    });
  });

  it("shows no action buttons for a terminal Done state besides the row link", () => {
    renderTable([makeRun({ id: "run-13", state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows action errors without calling onAction", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-14", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-14");
    });
    expect(onAction).not.toHaveBeenCalled();
  });
});
