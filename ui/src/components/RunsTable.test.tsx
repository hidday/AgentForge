import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

// Mock the api module before importing the component under test
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
    id: "run-123456789",
    linearIssueId: "issue-abcdefgh",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Some description",
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "acme/widgets",
    branchName: "fix/widget",
    prNumber: 17,
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
    // Table should not be rendered in the empty state
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders column headers", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("Issue")).toBeDefined();
    expect(screen.getByText("Repo")).toBeDefined();
    expect(screen.getByText("PR")).toBeDefined();
    expect(screen.getByText("Updated")).toBeDefined();
    expect(screen.getByText("Actions")).toBeDefined();
  });

  it("renders run values: title, repo, PR number, and state badge", () => {
    renderTable([makeRun({ state: "Implementing", prNumber: 42, repo: "acme/widgets" })]);

    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    // StateBadge formats "Implementing" as-is (no inner capitals to split)
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("renders em dash for prNumber when null", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when linearIssueTitle is null", () => {
    renderTable([makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" })]);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are both null", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefghijklmnop",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/team/issue/ENG-1" })]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe("https://linear.app/team/issue/ENG-1");
  });

  it("stops click propagation on the external Linear link so it doesn't also trigger row navigation", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/team/issue/ENG-1" })]);
    const link = screen.getByTitle("Open in Linear");
    const stopPropagationSpy = vi.spyOn(MouseEvent.prototype, "stopPropagation");
    fireEvent.click(link);
    expect(stopPropagationSpy).toHaveBeenCalled();
    stopPropagationSpy.mockRestore();
  });

  it("does not render an external Linear link when linearIssueUrl is null", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("links the issue title to the run detail page", () => {
    renderTable([makeRun({ id: "run-xyz" })]);
    const link = screen.getByText("Fix the thing").closest("a");
    expect(link?.getAttribute("href")).toBe("/runs/run-xyz");
  });

  it("renders multiple runs as multiple rows", () => {
    renderTable([
      makeRun({ id: "run-1", linearIssueTitle: "First" }),
      makeRun({ id: "run-2", linearIssueTitle: "Second" }),
    ]);
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
    expect(screen.getAllByRole("row").length).toBe(3); // header + 2 rows
  });

  describe("state-dependent action buttons", () => {
    it("shows Approve/Reject Plan buttons for AwaitingPlanApproval state and not other action buttons", () => {
      renderTable([makeRun({ state: "AwaitingPlanApproval" })]);
      expect(screen.getByTitle("Approve Plan")).toBeDefined();
      expect(screen.getByTitle("Reject Plan")).toBeDefined();
      expect(screen.queryByTitle("Approve & Complete")).toBeNull();
      expect(screen.queryByTitle("Pause Run")).toBeNull();
      expect(screen.queryByTitle("Resume Run")).toBeNull();
    });

    it("calls api.approvePlan and onAction when Approve Plan is clicked", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-approve", state: "AwaitingPlanApproval" })], onAction);

      await userEvent.click(screen.getByTitle("Approve Plan"));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-approve");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("calls api.rejectPlan and onAction when Reject Plan is clicked", async () => {
      mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-reject", state: "AwaitingPlanApproval" })], onAction);

      await userEvent.click(screen.getByTitle("Reject Plan"));

      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-reject");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not call onAction (and does not throw) when the action rejects", async () => {
      mockApi.approvePlan.mockRejectedValue(new Error("boom"));
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-fail", state: "AwaitingPlanApproval" })], onAction);

      await userEvent.click(screen.getByTitle("Approve Plan"));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-fail");
      });
      expect(onAction).not.toHaveBeenCalled();
    });

    it("works without an onAction prop supplied", async () => {
      mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
      renderTable([makeRun({ id: "run-no-cb", state: "AwaitingPlanApproval" })]);

      await userEvent.click(screen.getByTitle("Approve Plan"));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("run-no-cb");
      });
    });

    it("shows Approve & Complete button for ReadyForHumanReview state", async () => {
      mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-review", state: "ReadyForHumanReview" })], onAction);

      const btn = screen.getByTitle("Approve & Complete");
      expect(btn).toBeDefined();
      expect(screen.queryByTitle("Approve Plan")).toBeNull();

      await userEvent.click(btn);

      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith("run-review");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows Pause Run button for active-category states (e.g. Implementing)", async () => {
      mockApi.pauseRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-active", state: "Implementing" })], onAction);

      const btn = screen.getByTitle("Pause Run");
      await userEvent.click(btn);

      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith("run-active");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("does not show Pause Run for non-active states like Todo", () => {
      renderTable([makeRun({ state: "Todo" })]);
      expect(screen.queryByTitle("Pause Run")).toBeNull();
    });

    it("shows Resume Run button for AIBlocked state", async () => {
      mockApi.resumeRun.mockResolvedValue({ ok: true });
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-blocked", state: "AIBlocked" })], onAction);

      await userEvent.click(screen.getByTitle("Resume Run"));

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith("run-blocked");
        expect(onAction).toHaveBeenCalledOnce();
      });
    });

    it("shows Resume Run button for HumanClarificationNeeded state", () => {
      renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
      expect(screen.getByTitle("Resume Run")).toBeDefined();
    });

    it("shows no state-specific action buttons for Done state", () => {
      renderTable([makeRun({ state: "Done" })]);
      expect(screen.queryByTitle("Approve Plan")).toBeNull();
      expect(screen.queryByTitle("Reject Plan")).toBeNull();
      expect(screen.queryByTitle("Approve & Complete")).toBeNull();
      expect(screen.queryByTitle("Pause Run")).toBeNull();
      expect(screen.queryByTitle("Resume Run")).toBeNull();
    });
  });
});
