import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
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

  it("shows an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("prefers the issue title, falling back to identifier, falling back to id prefix", () => {
    renderTable([
      makeRun({ id: "r1", linearIssueTitle: "Has a title" }),
      makeRun({
        id: "r2",
        linearIssueId: "issue-2",
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-2",
      }),
      makeRun({
        id: "r3",
        linearIssueId: "abcdefgh12345",
        linearIssueTitle: null,
        linearIssueIdentifier: null,
      }),
    ]);
    expect(screen.getByText("Has a title")).toBeDefined();
    expect(screen.getByText("ENG-2")).toBeDefined();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("links the issue cell to the run detail page", () => {
    renderTable([makeRun({ id: "run-42", linearIssueTitle: "Some issue" })]);
    const link = screen.getByRole("link", { name: "Some issue" });
    expect(link.getAttribute("href")).toBe("/runs/run-42");
  });

  it("shows an external Linear link only when a URL is present", () => {
    const { rerender } = renderTable([
      makeRun({ linearIssueUrl: "https://linear.app/issue/1" }),
    ]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("stops the external Linear link's click from bubbling up to ancestors", async () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <MemoryRouter>
          <RunsTable
            runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]}
          />
        </MemoryRouter>
      </div>,
    );

    await userEvent.click(screen.getByTitle("Open in Linear"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("shows the PR number when present, or an em dash placeholder when absent", () => {
    renderTable([
      makeRun({ id: "r1", prNumber: 123 }),
      makeRun({ id: "r2", prNumber: null }),
    ]);
    expect(screen.getByText("#123")).toBeDefined();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("shows the repo name", () => {
    renderTable([makeRun({ repo: "acme/widgets" })]);
    expect(screen.getByText("acme/widgets")).toBeDefined();
  });

  it("shows Approve/Reject Plan actions for AwaitingPlanApproval and calls the API on click", async () => {
    mockApi.approvePlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    await userEvent.click(approveBtn);

    expect(mockApi.approvePlan).toHaveBeenCalledWith("run-9");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("calls rejectPlan when the Reject Plan button is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-9");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("shows an Approve & Complete action for ReadyForHumanReview and calls approveReview", async () => {
    mockApi.approveReview.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-5", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));

    expect(mockApi.approveReview).toHaveBeenCalledWith("run-5");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("shows a Pause action for active-category states and calls pauseRun", async () => {
    mockApi.pauseRun.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-7", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));

    expect(mockApi.pauseRun).toHaveBeenCalledWith("run-7");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("does not show a Pause action for a non-active state", () => {
    renderTable([makeRun({ state: "Todo" })]);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
  });

  it("shows a Resume action for AIBlocked and calls resumeRun", async () => {
    mockApi.resumeRun.mockResolvedValue({});
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-8", state: "AIBlocked" })], onAction);

    await userEvent.click(screen.getByTitle("Resume Run"));

    expect(mockApi.resumeRun).toHaveBeenCalledWith("run-8");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
  });

  it("shows a Resume action for HumanClarificationNeeded", () => {
    renderTable([makeRun({ state: "HumanClarificationNeeded" })]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not call onAction and does not throw when the API call fails", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-9", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await vi.waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("always renders a chevron link through to the run detail page", () => {
    renderTable([makeRun({ id: "run-3", state: "Todo" })]);
    const links = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href") === "/runs/run-3");
    // one link on the issue title, one chevron link in the actions column
    expect(links.length).toBe(2);
    expect(links[1].querySelector("svg.lucide-chevron-right")).not.toBeNull();
  });
});
