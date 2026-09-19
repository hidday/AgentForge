import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import { RunsTable } from "./RunsTable.tsx";

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

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-123",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/issue/ENG-123",
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: 42,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
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
    Object.values(mockApi).forEach((fn) => fn.mockResolvedValue({ ok: true }));
  });

  it("shows the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders a row with issue title, repo, and PR number", () => {
    renderTable([makeRun()]);
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("#42")).toBeDefined();
  });

  it("falls back to the issue identifier when no title is set", () => {
    renderTable([makeRun({ linearIssueTitle: null })]);
    expect(screen.getByText("ENG-123")).toBeDefined();
  });

  it("falls back to a truncated issue id when neither title nor identifier is set", () => {
    renderTable([
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueId: "abcdefgh-1234" }),
    ]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("shows an em dash when there is no PR number", () => {
    renderTable([makeRun({ prNumber: null })]);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders an external Linear link when linearIssueUrl is set, and not otherwise", () => {
    const { rerender } = renderTable([makeRun()]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: null })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("clicking the external Linear link does not trigger row navigation or action handlers", async () => {
    const onAction = vi.fn();
    renderTable([makeRun()], onAction);

    const link = screen.getByTitle("Open in Linear");
    await userEvent.click(link);

    // The click handler calls stopPropagation and does not call any API
    // action or onAction — it's purely to keep the anchor's own navigation
    // isolated from the row.
    expect(onAction).not.toHaveBeenCalled();
    expect(Object.values(mockApi).every((fn) => !fn.mock.calls.length)).toBe(true);
  });

  it("shows Approve/Reject Plan buttons for AwaitingPlanApproval and calls the API", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });

    await userEvent.click(screen.getByTitle("Reject Plan"));
    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledTimes(2);
    });
  });

  it("shows Approve & Complete for ReadyForHumanReview and calls the API", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("shows Pause for an active-category state and calls the API", async () => {
    renderTable([makeRun({ state: "Implementing" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("shows Resume for AIBlocked and HumanClarificationNeeded and calls the API", async () => {
    const { rerender } = renderTable([makeRun({ state: "AIBlocked" })]);
    await userEvent.click(screen.getByTitle("Resume Run"));
    await waitFor(() => {
      expect(mockApi.resumeRun).toHaveBeenCalledWith("run-1");
    });

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ state: "HumanClarificationNeeded" })]} />
      </MemoryRouter>,
    );
    expect(screen.getByTitle("Resume Run")).toBeDefined();
  });

  it("does not call onAction when it is not provided", async () => {
    renderTable([makeRun({ state: "Implementing" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
    // No assertion needed beyond "did not throw" — onAction?.() safely no-ops.
  });

  it("swallows action errors without throwing", async () => {
    mockApi.pauseRun.mockRejectedValue(new Error("failed"));
    renderTable([makeRun({ state: "Implementing" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalled();
    });
  });

  it("renders a link to the run detail page", () => {
    renderTable([makeRun()]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-1")).toBe(true);
  });
});
