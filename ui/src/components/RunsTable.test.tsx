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

function makeRun(overrides: Partial<Run> & { id: string }): Run {
  const defaults: Run = {
    id: overrides.id,
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
  // Use explicit key presence so passing a field as `null` (e.g. to test a
  // fallback branch) isn't clobbered back to its default by `??`.
  return { ...defaults, ...overrides };
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

  it("renders table headers and a row per run", () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2", linearIssueTitle: "Other" })];
    renderTable(runs);
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("Issue")).toBeDefined();
    expect(screen.getByText("Repo")).toBeDefined();
    expect(screen.getByText("PR")).toBeDefined();
    expect(screen.getByText("Updated")).toBeDefined();
    expect(screen.getByText("Actions")).toBeDefined();
    expect(screen.getAllByRole("row").length).toBe(3); // header + 2 runs
  });

  it("shows the issue title when present, and links to the run detail page", () => {
    const runs = [makeRun({ id: "r1", linearIssueTitle: "Fix the bug" })];
    renderTable(runs);
    const link = screen.getByText("Fix the bug").closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/runs/r1");
  });

  it("falls back to the issue identifier when title is missing", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: null, linearIssueIdentifier: "ENG-42" }),
    ];
    renderTable(runs);
    expect(screen.getByText("ENG-42")).toBeDefined();
  });

  it("falls back to a truncated issue id when title and identifier are both missing", () => {
    const runs = [
      makeRun({
        id: "r1",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ];
    renderTable(runs);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external link to Linear only when linearIssueUrl is present", async () => {
    const withUrl = makeRun({ id: "r1", linearIssueUrl: "https://linear.app/issue/1" });
    const { rerender } = render(
      <MemoryRouter>
        <RunsTable runs={[withUrl]} />
      </MemoryRouter>,
    );
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe("https://linear.app/issue/1");
    // Clicking it should stop propagation rather than bubble to the row/Link.
    await userEvent.click(externalLink);

    const withoutUrl = makeRun({ id: "r2", linearIssueUrl: null });
    rerender(
      <MemoryRouter>
        <RunsTable runs={[withoutUrl]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("renders the PR number when present and a dash when absent", () => {
    const runs = [
      makeRun({ id: "r1", prNumber: 123 }),
      makeRun({ id: "r2", prNumber: null }),
    ];
    renderTable(runs);
    expect(screen.getByText("#123")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders the repo name as monospace text", () => {
    const runs = [makeRun({ id: "r1", repo: "acme/widgets" })];
    renderTable(runs);
    expect(screen.getByText("acme/widgets")).toBeDefined();
  });

  it("shows Approve/Reject plan buttons for AwaitingPlanApproval and calls the API on click", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("calls rejectPlan when the Reject Plan button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "AwaitingPlanApproval" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("shows an Approve & Complete button for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "ReadyForHumanReview" })];
    renderTable(runs, onAction);

    const btn = screen.getByTitle("Approve & Complete");
    expect(btn).toBeDefined();
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("shows a Pause button for runs in an active-category state and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "Implementing" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("does not show a Pause button for a non-active-category state", () => {
    const runs = [makeRun({ id: "r1", state: "Done" })];
    renderTable(runs);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows a Resume button for AIBlocked and HumanClarificationNeeded and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "AIBlocked" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalled();
    });
  });

  it("shows a Resume button for HumanClarificationNeeded state", () => {
    const runs = [makeRun({ id: "r1", state: "HumanClarificationNeeded" })];
    renderTable(runs);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not call onAction and does not throw when the API action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    const runs = [makeRun({ id: "r1", state: "Implementing" })];
    renderTable(runs, onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction prop when an action succeeds", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const runs = [makeRun({ id: "r1", state: "Implementing" })];
    renderTable(runs);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
    });
  });

  it("does not render plan/review/pause/resume action buttons for states that match none of those branches", () => {
    const runs = [makeRun({ id: "r1", state: "Todo" })];
    renderTable(runs);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("always renders a chevron link to the run detail page", () => {
    const runs = [makeRun({ id: "r1", state: "Todo" })];
    const { container } = renderTable(runs);
    const links = container.querySelectorAll('a[href="/runs/r1"]');
    // one for the issue title, one for the chevron
    expect(links.length).toBe(2);
  });
});
