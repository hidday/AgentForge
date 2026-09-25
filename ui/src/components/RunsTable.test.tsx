import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", async () => {
  const actual = await vi.importActual<typeof import("@/api/client.ts")>(
    "@/api/client.ts",
  );
  return {
    ...actual,
    api: {
      approvePlan: vi.fn(),
      rejectPlan: vi.fn(),
      approveReview: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
    },
  };
});

import { RunsTable } from "./RunsTable.tsx";
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
    linearIssueId: "issue-abcdefgh12345",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/x",
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

  it("renders empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders a row per run with title fallback chain: title > identifier > id prefix", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "Fix the bug" }),
      makeRun({
        id: "r2",
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-42",
      }),
      makeRun({
        id: "r3",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ];
    renderTable(runs);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("ENG-42")).toBeDefined();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders repo, PR number, and dash when no PR", () => {
    const runs = [
      makeRun({ id: "r1", repo: "acme/api", prNumber: 17 }),
      makeRun({ id: "r2", repo: "acme/web", prNumber: null }),
    ];
    renderTable(runs);
    expect(screen.getByText("acme/api")).toBeDefined();
    expect(screen.getByText("#17")).toBeDefined();
    expect(screen.getByText("acme/web")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders the state badge reflecting the run's state", () => {
    renderTable([makeRun({ id: "r1", state: "Done" })]);
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("renders a Linear external link when linearIssueUrl is present", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueUrl: "https://linear.app/issue/1" }),
    ]);
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe("https://linear.app/issue/1");
    expect(externalLink.getAttribute("target")).toBe("_blank");
  });

  it("does not render a Linear external link when linearIssueUrl is absent", () => {
    renderTable([makeRun({ id: "r1", linearIssueUrl: null })]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("calls stopPropagation when the Linear external link is clicked", async () => {
    renderTable([
      makeRun({
        id: "r1",
        linearIssueUrl: "https://linear.app/issue/1",
        linearIssueTitle: "Some issue",
      }),
    ]);
    const externalLink = screen.getByTitle("Open in Linear");
    const stopPropagationSpy = vi.spyOn(Event.prototype, "stopPropagation");

    await userEvent.click(externalLink);

    expect(stopPropagationSpy).toHaveBeenCalled();
    stopPropagationSpy.mockRestore();
  });

  it("links the issue title and chevron to the run detail route", () => {
    renderTable([makeRun({ id: "run-xyz", linearIssueTitle: "Some issue" })]);
    const issueLink = screen.getByRole("link", { name: "Some issue" });
    expect(issueLink.getAttribute("href")).toBe("/runs/run-xyz");
  });

  it("shows approve/reject plan buttons for AwaitingPlanApproval state", () => {
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })]);
    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
  });

  it("calls api.approvePlan with the run id and onAction on click", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-9");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.rejectPlan with the run id on reject click", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })]);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-9");
    });
  });

  it("shows Approve & Complete button for ReadyForHumanReview and calls api.approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-5", state: "ReadyForHumanReview" })], onAction);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-5");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Pause button for active-category states and calls api.pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-3", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-3");
    });
  });

  it("does not show Pause button for non-active states", () => {
    renderTable([makeRun({ id: "run-3", state: "Done" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it.each(["AIBlocked", "HumanClarificationNeeded"])(
    "shows Resume button for %s and calls api.resumeRun",
    async (state) => {
      mockApi.resumeRun.mockResolvedValue({ ok: true });
      renderTable([makeRun({ id: "run-4", state })]);

      await userEvent.click(screen.getByTitle("Resume Run"));

      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith("run-4");
      });
    },
  );

  it("swallows action errors without calling onAction", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-3", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback provided", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-3", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
  });
});
