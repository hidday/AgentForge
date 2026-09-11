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
    linearIssueId: "issue-1234567890",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the login bug",
    linearIssueUrl: null,
    repo: "acme/webapp",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders table headers and one row per run", () => {
    renderTable([makeRun({ id: "a" }), makeRun({ id: "b", linearIssueTitle: "Second" })]);
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("Issue")).toBeDefined();
    expect(screen.getByText("Repo")).toBeDefined();
    expect(screen.getByText("PR")).toBeDefined();
    expect(screen.getByText("Updated")).toBeDefined();
    expect(screen.getByText("Actions")).toBeDefined();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 rows
  });

  it("uses linearIssueTitle when present", () => {
    renderTable([makeRun({ linearIssueTitle: "Fix the login bug" })]);
    expect(screen.getByText("Fix the login bug")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when title is missing", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" }),
    ]);
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are missing", () => {
    renderTable([
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueId: "abcdefgh12345",
      }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is present", () => {
    const { rerender } = renderTable([
      makeRun({ linearIssueUrl: "https://linear.app/acme/issue/ENG-42" }),
    ]);
    const link = screen.getByTitle("Open in Linear");
    expect(link.getAttribute("href")).toBe(
      "https://linear.app/acme/issue/ENG-42",
    );

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("clicking the external Linear link invokes its stopPropagation handler without crashing", async () => {
    renderTable([
      makeRun({
        id: "run-ext",
        linearIssueUrl: "https://linear.app/acme/issue/ENG-42",
      }),
    ]);
    const link = screen.getByTitle("Open in Linear");

    await userEvent.click(link);

    // The link and its href survive the click (the handler only stops
    // propagation, it doesn't prevent default or unmount anything).
    expect(screen.getByTitle("Open in Linear").getAttribute("href")).toBe(
      "https://linear.app/acme/issue/ENG-42",
    );
  });

  it("renders the repo and a PR number when present", () => {
    renderTable([makeRun({ repo: "acme/webapp", prNumber: 17 })]);
    expect(screen.getByText("acme/webapp")).toBeDefined();
    expect(screen.getByText("#17")).toBeDefined();
  });

  it("renders an em dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders the state badge label for the run's state", () => {
    renderTable([makeRun({ state: "AIBlocked" })]);
    // formatStateName inserts a space before every capital, so consecutive
    // capitals ("AI") are split individually.
    expect(screen.getByText("A I Blocked")).toBeDefined();
  });

  it("links the issue title and the chevron to the run detail page", () => {
    renderTable([makeRun({ id: "run-77" })]);
    const links = screen.getAllByRole("link").filter((l) =>
      l.getAttribute("href") === "/runs/run-77",
    );
    expect(links.length).toBe(2); // title link + chevron link
  });

  it("shows Approve/Reject actions only for AwaitingPlanApproval and calls the API", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    const rejectBtn = screen.getByTitle("Reject Plan");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    await userEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("Reject Plan button calls api.rejectPlan", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "PlanRevision" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r2", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("r2");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("does not render Approve/Reject actions for other states", () => {
    renderTable([makeRun({ state: "Implementing" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
  });

  it("shows an Approve & Complete action for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r3", state: "ReadyForHumanReview" })], onAction);

    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("r3");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Pause action for active-category states and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r4", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r4");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Resume action for AIBlocked and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r5", state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("r5");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows a Resume action for HumanClarificationNeeded", () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not blow up and does not call onAction when the action rejects", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("network error"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r6", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "r7", state: "Implementing" })]);

    await userEvent.click(screen.getByTitle("Pause Run"));

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("r7");
    });
  });
});
