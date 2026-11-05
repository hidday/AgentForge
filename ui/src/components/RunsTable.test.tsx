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
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "agent/eng-1",
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/eng-1",
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
    expect(screen.getByText(/No runs found/i)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row with repo, PR placeholder, and relative time", () => {
    const run = makeRun({ prNumber: null });
    renderTable([run]);

    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("shows the PR number when present", () => {
    const run = makeRun({ prNumber: 42 });
    renderTable([run]);
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("links the issue title and the chevron to the run detail page", () => {
    const run = makeRun({ id: "run-abc" });
    renderTable([run]);

    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs.filter((h) => h === "/runs/run-abc").length).toBe(2);
  });

  it("falls back to linearIssueIdentifier when there is no title", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" });
    renderTable([run]);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a slice of linearIssueId when there is no title or identifier", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefghijklmnop",
    });
    renderTable([run]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    const run = makeRun({ linearIssueUrl: "https://linear.app/acme/issue/ENG-1" });
    renderTable([run]);
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe("https://linear.app/acme/issue/ENG-1");
    expect(externalLink.getAttribute("target")).toBe("_blank");
  });

  it("stops propagation when the external Linear link is clicked, without triggering a row action", async () => {
    const onAction = vi.fn();
    const run = makeRun({
      linearIssueUrl: "https://linear.app/acme/issue/ENG-1",
      state: "AwaitingPlanApproval",
    });
    renderTable([run], onAction);

    await userEvent.click(screen.getByTitle("Open in Linear"));

    expect(onAction).not.toHaveBeenCalled();
    expect(mockApi.approvePlan).not.toHaveBeenCalled();
  });

  it("does not render an external Linear link when linearIssueUrl is absent", () => {
    const run = makeRun({ linearIssueUrl: null });
    renderTable([run]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("renders no action buttons for a plain Todo run (only the chevron link)", () => {
    const run = makeRun({ state: "Todo" });
    renderTable([run]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("shows approve/reject plan buttons for AwaitingPlanApproval and calls the API on click", async () => {
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const run = makeRun({ id: "run-approve", state: "AwaitingPlanApproval" });
    renderTable([run], onAction);

    expect(screen.queryByTitle("Pause Run")).toBeNull();

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-approve");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls rejectPlan when the reject button is clicked", async () => {
    const onAction = vi.fn();
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    const run = makeRun({ id: "run-reject", state: "AwaitingPlanApproval" });
    renderTable([run], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-reject");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows the Approve & Complete button for ReadyForHumanReview and calls approveReview", async () => {
    const onAction = vi.fn();
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const run = makeRun({ id: "run-review", state: "ReadyForHumanReview" });
    renderTable([run], onAction);

    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    await userEvent.click(screen.getByTitle("Approve & Complete"));

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-review");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Pause button for active-category states and calls pauseRun", async () => {
    const onAction = vi.fn();
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const run = makeRun({ id: "run-active", state: "Implementing" });
    renderTable([run], onAction);

    expect(screen.queryByTitle("Resume Run")).toBeNull();
    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-active");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Resume button for AIBlocked and calls resumeRun", async () => {
    const onAction = vi.fn();
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const run = makeRun({ id: "run-blocked", state: "AIBlocked" });
    renderTable([run], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-blocked");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Resume button for HumanClarificationNeeded and calls resumeRun", async () => {
    const onAction = vi.fn();
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const run = makeRun({ id: "run-clarify", state: "HumanClarificationNeeded" });
    renderTable([run], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-clarify");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("swallows action errors and does not call onAction when the API call rejects", async () => {
    const onAction = vi.fn();
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const run = makeRun({ id: "run-error", state: "AwaitingPlanApproval" });
    renderTable([run], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-error");
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback (optional prop)", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const run = makeRun({ id: "run-no-callback", state: "AwaitingPlanApproval" });
    renderTable([run]);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-no-callback");
    });
  });

  it("renders multiple rows for multiple runs", () => {
    const runs = [
      makeRun({ id: "r1", linearIssueTitle: "First" }),
      makeRun({ id: "r2", linearIssueTitle: "Second" }),
    ];
    renderTable(runs);
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
    expect(screen.getAllByRole("row").length).toBe(3); // header + 2 rows
  });
});
