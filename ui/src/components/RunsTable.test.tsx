import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import { RunsTable } from "./RunsTable.tsx";
import { api } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

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
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "org/repo",
    branchName: "fix/bug",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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
    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a table row per run with issue title, repo, PR number and state badge", () => {
    renderTable([makeRun()]);
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("falls back to the issue identifier when title is missing", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when both title and identifier are missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an em dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("links the issue title to the run detail page", () => {
    renderTable([makeRun({ id: "run-xyz" })]);
    const link = screen.getByRole("link", { name: "Fix the bug" });
    expect(link.getAttribute("href")).toBe("/runs/run-xyz");
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    renderTable([makeRun()]);
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe(
      "https://linear.app/team/issue/ENG-1",
    );
    expect(externalLink.getAttribute("target")).toBe("_blank");
  });

  it("does not render an external Linear link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("shows Approve/Reject plan buttons only for AwaitingPlanApproval state", () => {
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);
    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
  });

  it("calls api.approvePlan and onAction when Approve Plan is clicked", async () => {
    mockApi.approvePlan.mockResolvedValue(undefined);
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-approve", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-approve");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.rejectPlan and onAction when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue(undefined);
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-reject", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-reject");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not call onAction when the API action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback (optional prop)", async () => {
    mockApi.approvePlan.mockResolvedValue(undefined);
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    });
  });

  it("shows the Approve & Complete button only for ReadyForHumanReview state", async () => {
    mockApi.approveReview.mockResolvedValue(undefined);
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-review", state: "ReadyForHumanReview" })], onAction);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-review");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Pause button for an active-category state and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue(undefined);
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-active", state: "Implementing" })], onAction);

    const btn = screen.getByTitle("Pause Run");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-active");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not show the Pause button for a non-active state", () => {
    renderTable([makeRun({ state: "Todo" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it.each(["AIBlocked", "HumanClarificationNeeded"])(
    "shows the Resume button and calls api.resumeRun for %s",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue(undefined);
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-blocked", state })], onAction);

      const btn = screen.getByTitle("Resume Run");
      await userEvent.click(btn);

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith("run-blocked");
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("does not show the Resume button for a state that is not blocked/clarification", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("always renders a chevron link to the run detail page", () => {
    renderTable([makeRun({ id: "run-chevron", state: "Done" })]);
    const links = screen.getAllByRole("link");
    const detailLink = links.find((l) => l.getAttribute("href") === "/runs/run-chevron");
    expect(detailLink).toBeDefined();
  });

  it("renders multiple rows for multiple runs", () => {
    renderTable([
      makeRun({ id: "run-1", linearIssueTitle: "First issue" }),
      makeRun({ id: "run-2", linearIssueTitle: "Second issue" }),
    ]);
    expect(screen.getByText("First issue")).toBeDefined();
    expect(screen.getByText("Second issue")).toBeDefined();
    expect(screen.getAllByRole("row").length).toBe(3); // 1 header + 2 data rows
  });
});
