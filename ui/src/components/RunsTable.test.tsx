import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1234567890",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Run;
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
    mockApi.approvePlan.mockResolvedValue({});
    mockApi.rejectPlan.mockResolvedValue({});
    mockApi.approveReview.mockResolvedValue({});
    mockApi.pauseRun.mockResolvedValue({});
    mockApi.resumeRun.mockResolvedValue({});
  });

  it("renders an empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders run rows with issue title, repo, PR number, and state", () => {
    const run = makeRun({ prNumber: 42 });
    renderTable([run]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("shows an em-dash when there is no PR number", () => {
    const run = makeRun({ prNumber: null });
    renderTable([run]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("falls back to linearIssueIdentifier when title is missing", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-9" });
    renderTable([run]);
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when title and identifier are missing", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefgh12345",
    });
    renderTable([run]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is present", () => {
    const run = makeRun({ linearIssueUrl: "https://linear.app/team/issue/ENG-1" });
    renderTable([run]);
    const link = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://linear.app/team/issue/ENG-1");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("does not render the external link when linearIssueUrl is absent", () => {
    const run = makeRun({ linearIssueUrl: null });
    renderTable([run]);
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("stops propagation when the external Linear link is clicked, so an ancestor React click handler does not see it", async () => {
    const user = userEvent.setup();
    const run = makeRun({ linearIssueUrl: "https://linear.app/team/issue/ENG-1" });
    const outerClickHandler = vi.fn();

    render(
      <MemoryRouter>
        <div onClick={outerClickHandler}>
          <RunsTable runs={[run]} />
        </div>
      </MemoryRouter>,
    );

    const link = screen.getByTitle("Open in Linear");
    await user.click(link);

    expect(outerClickHandler).not.toHaveBeenCalled();
  });

  it("shows Approve/Reject Plan buttons for AwaitingPlanApproval and calls api.approvePlan", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const run = makeRun({ state: "AwaitingPlanApproval" });
    renderTable([run], onAction);

    const approveBtn = screen.getByTitle("Approve Plan");
    await user.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("calls api.rejectPlan when Reject Plan is clicked", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const run = makeRun({ state: "AwaitingPlanApproval" });
    renderTable([run], onAction);

    const rejectBtn = screen.getByTitle("Reject Plan");
    await user.click(rejectBtn);

    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Approve & Complete button for ReadyForHumanReview and calls api.approveReview", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const run = makeRun({ state: "ReadyForHumanReview" });
    renderTable([run], onAction);

    const approveBtn = screen.getByTitle("Approve & Complete");
    await user.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Pause Run button for active-category states and calls api.pauseRun", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const run = makeRun({ state: "Planning" });
    renderTable([run], onAction);

    const pauseBtn = screen.getByTitle("Pause Run");
    await user.click(pauseBtn);

    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Resume Run button for AIBlocked and calls api.resumeRun", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const run = makeRun({ state: "AIBlocked" });
    renderTable([run], onAction);

    const resumeBtn = screen.getByTitle("Resume Run");
    await user.click(resumeBtn);

    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Resume Run button for HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    renderTable([run]);
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not throw and simply skips onAction when onAction is not provided", async () => {
    const user = userEvent.setup();
    const run = makeRun({ state: "ReadyForHumanReview" });
    renderTable([run]);

    const approveBtn = screen.getByTitle("Approve & Complete");
    await user.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
    });
  });

  it("swallows action errors without throwing and without calling onAction", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mockApi.approveReview.mockRejectedValue(new Error("boom"));
    const run = makeRun({ state: "ReadyForHumanReview" });
    renderTable([run], onAction);

    const approveBtn = screen.getByTitle("Approve & Complete");
    await user.click(approveBtn);

    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalled();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not show any action buttons for a Done run other than the row link", () => {
    const run = makeRun({ state: "Done" });
    renderTable([run]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("renders a row link to the run detail page", () => {
    const run = makeRun({ id: "run-42" });
    renderTable([run]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-42")).toBe(
      true,
    );
  });
});
