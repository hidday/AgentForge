import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage.tsx";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/api/client.ts", () => ({
  api: {
    fetchPendingIssues: vi.fn(),
    ingestIssues: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { useRuns } from "@/hooks/useRuns.ts";
import { api } from "@/api/client.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;
const mockApi = api as unknown as {
  fetchPendingIssues: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByText(/no runs found/i)).toBeNull();
  });

  it("renders an error message when the runs hook reports an error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByText(/loading runs/i)).toBeNull();
  });

  it("renders the runs table with rows and stats when data loads", () => {
    const runs = [
      makeRun({ id: "run-1", state: "Implementing", linearIssueTitle: "First run" }),
      makeRun({ id: "run-2", state: "Done", linearIssueTitle: "Second run" }),
      makeRun({ id: "run-3", state: "AIBlocked", linearIssueTitle: "Third run" }),
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("First run")).toBeDefined();
    expect(screen.getByText("Second run")).toBeDefined();
    expect(screen.getByText("Third run")).toBeDefined();

    // Stats bar: Total should reflect all 3 runs.
    const totalLabel = screen.getByText("Total");
    const totalStat = totalLabel.previousElementSibling;
    expect(totalStat?.textContent).toBe("3");
  });

  it("renders the empty state when there are no runs", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/no runs found/i)).toBeDefined();
  });

  it("filters the displayed runs when a filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "run-1", state: "Done", linearIssueTitle: "Done run" }),
      makeRun({ id: "run-2", state: "Implementing", linearIssueTitle: "Active run" }),
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // Both present under the default "All" filter.
    expect(screen.getByText("Done run")).toBeDefined();
    expect(screen.getByText("Active run")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("Done run")).toBeDefined();
    expect(screen.queryByText("Active run")).toBeNull();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-a",
          title: "Pending issue",
          description: "",
          state: "Todo",
          labels: [],
          priority: 2,
        },
      ],
    });

    renderPage();

    expect(screen.queryByText(/sync from linear/i, { selector: "h3" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));

    await waitFor(() => {
      expect(screen.getByText("Pending issue")).toBeDefined();
    });
  });

  it("shows the ingest summary banner after a sync completes, and lets the user dismiss it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-a",
          title: "Pending issue",
          description: "",
          state: "Todo",
          labels: [],
          priority: 2,
        },
      ],
    });
    const mockApiFull = api as unknown as { ingestIssues: ReturnType<typeof vi.fn> };
    mockApiFull.ingestIssues.mockResolvedValue({
      ok: true,
      started: ["issue-a"],
      skipped: [],
    });

    renderPage();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await waitFor(() => expect(screen.getByText("Pending issue")).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(screen.getByText(/started 1 run/i)).toBeDefined();
    });

    // Dismiss manually.
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/started 1 run/i)).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-a",
          title: "Pending issue",
          description: "",
          state: "Todo",
          labels: [],
          priority: 2,
        },
      ],
    });
    const mockApiFull = api as unknown as { ingestIssues: ReturnType<typeof vi.fn> };
    mockApiFull.ingestIssues.mockResolvedValue({
      ok: true,
      started: ["issue-a"],
      skipped: [],
    });

    renderPage();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await waitFor(() => expect(screen.getByText("Pending issue")).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => {
      expect(screen.getByText(/started 1 run/i)).toBeDefined();
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText(/started 1 run/i)).toBeNull();
  });
});
