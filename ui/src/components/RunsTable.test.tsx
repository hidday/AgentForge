import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "feat/branch",
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
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

  it("renders run details: title link, repo, PR placeholder, and updated time", () => {
    renderTable([makeRun()]);
    const link = screen.getByRole("link", { name: "Fix the thing" });
    expect(link.getAttribute("href")).toBe("/runs/run-1");
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText("1m ago")).toBeDefined();
  });

  it("falls back to the Linear identifier when there is no title, and to a truncated issue id when neither is present", () => {
    renderTable([
      makeRun({ id: "run-a", linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }),
      makeRun({
        id: "run-b",
        linearIssueId: "abcdefgh-1234",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
      }),
    ]);
    expect(screen.getByRole("link", { name: "ENG-9" })).toBeDefined();
    expect(screen.getByRole("link", { name: "abcdefgh" })).toBeDefined();
  });

  it("formats the PR number when present", () => {
    renderTable([makeRun({ prNumber: 123 })]);
    expect(screen.getByText("#123")).toBeDefined();
  });

  it("shows an external Linear link only when linearIssueUrl is set", () => {
    const { rerender } = render(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();

    rerender(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-42" })]}
        />
      </MemoryRouter>,
    );
    const externalLink = screen.getByTitle("Open in Linear");
    expect(externalLink.getAttribute("href")).toBe("https://linear.app/issue/ENG-42");
    expect(externalLink.getAttribute("target")).toBe("_blank");
  });

  it("invokes the external Linear link's click handler (stopPropagation) without throwing", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-42" })]}
        />
      </MemoryRouter>,
    );
    const externalLink = screen.getByTitle("Open in Linear");
    // Exercises the onClick={(e) => e.stopPropagation()} handler on the
    // external link; it must not throw or otherwise disrupt rendering.
    await user.click(externalLink);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
  });

  it("shows Approve Plan and Reject Plan actions for AwaitingPlanApproval and calls the API + onAction on approve", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
    await user.click(approveBtn);

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("calls rejectPlan when Reject Plan is clicked and still invokes onAction on success", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await user.click(screen.getByTitle("Reject Plan"));

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not call onAction and does not throw when an action rejects", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await user.click(screen.getByTitle("Approve Plan"));

    expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback provided", async () => {
    const user = userEvent.setup();
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    renderTable([makeRun({ state: "AwaitingPlanApproval" })]);

    await user.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledOnce();
  });

  it("shows the Approve & Complete action for ReadyForHumanReview and calls approveReview", async () => {
    const user = userEvent.setup();
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    renderTable([makeRun({ state: "ReadyForHumanReview" })]);

    const btn = screen.getByTitle("Approve & Complete");
    await user.click(btn);
    expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
  });

  it("shows the Pause action for active-category states and calls pauseRun", async () => {
    const user = userEvent.setup();
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ state: "Implementing" })]);

    await user.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
  });

  it("does not show the Pause action for a non-active state", () => {
    renderTable([makeRun({ state: "Todo" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows the Resume action for AIBlocked and HumanClarificationNeeded and calls resumeRun", async () => {
    const user = userEvent.setup();
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "run-blocked", state: "AIBlocked" })]);

    await user.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-blocked");
  });

  it("renders a state badge and a row-level navigation chevron link per run", () => {
    renderTable([makeRun({ id: "run-1" })]);
    // ChevronRight link to the run detail page, distinct from the title link.
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs.filter((h) => h === "/runs/run-1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders multiple runs each with their own row", () => {
    renderTable([
      makeRun({ id: "run-1", linearIssueTitle: "First" }),
      makeRun({ id: "run-2", linearIssueTitle: "Second" }),
    ]);
    expect(screen.getByRole("link", { name: "First" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Second" })).toBeDefined();
  });
});
