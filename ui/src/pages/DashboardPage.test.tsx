import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

// LinearSyncDialog (rendered for real, for integration coverage of the
// Sync-from-Linear flow) relies on useSSE internally; stub it out so no real
// EventSource is created in jsdom.
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: () => {},
}));

vi.mock("@/api/client.ts", () => ({
  api: {
    fetchPendingIssues: vi.fn(),
    ingestIssues: vi.fn(),
  },
}));

import { DashboardPage } from "./DashboardPage.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  fetchPendingIssues: ReturnType<typeof vi.fn>;
  ingestIssues: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some run",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
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

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByText(/No runs found/i)).toBeNull();
  });

  it("shows an error message instead of the table when loading fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network unreachable",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network unreachable")).toBeDefined();
    expect(screen.queryByText(/No runs found/i)).toBeNull();
  });

  it("renders the empty state and zeroed stats when there are no runs", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("No runs found")).toBeDefined();
    // "Total" stat value should read 0
    const totalLabel = screen.getByText("Total");
    expect(totalLabel.previousSibling?.textContent).toBe("0");
  });

  it("computes per-category stat counts from the runs list", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }), // active
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
        makeRun({ id: "r3", state: "AIBlocked" }), // blocked
        makeRun({ id: "r4", state: "Done" }), // done
        makeRun({ id: "r5", state: "Planning" }), // active
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    // "Active" and "Done" also appear as filter-pill button labels, so scope
    // these lookups to the stat labels (non-button <div> elements).
    const statLabel = (label: string) =>
      screen.getByText(label, { selector: "div" });

    expect(statLabel("Total").previousSibling?.textContent).toBe("5");
    expect(statLabel("Active").previousSibling?.textContent).toBe("2");
    expect(statLabel("Awaiting").previousSibling?.textContent).toBe("1");
    expect(statLabel("Blocked").previousSibling?.textContent).toBe("1");
    expect(statLabel("Done").previousSibling?.textContent).toBe("1");
  });

  it("filters the visible runs when a filter pill is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active run" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done run" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.getByText("Done run")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.queryByText("Done run")).toBeNull();
  });

  it("highlights the currently selected filter pill", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const allBtn = screen.getByRole("button", { name: "All" });
    const doneBtn = screen.getByRole("button", { name: "Done" });
    expect(allBtn.className).toContain("bg-accent");
    expect(doneBtn.className).not.toContain("bg-accent");

    await userEvent.click(doneBtn);
    expect(doneBtn.className).toContain("bg-accent");
    expect(allBtn.className).not.toContain("bg-accent");
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it on Cancel", async () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.queryByText("Sync from Linear", { selector: "h3" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));

    await waitFor(() => {
      expect(screen.getByText("Sync from Linear", { selector: "h3" })).toBeDefined();
    });
    expect(mockApi.fetchPendingIssues).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Sync from Linear", { selector: "h3" })).toBeNull();
  });

  it("shows an ingest summary banner after a successful sync, then auto-dismisses it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
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
            id: "issue-1",
            title: "Fix thing",
            description: "",
            state: "Todo",
            labels: [],
            priority: 0,
          },
        ],
      });
      mockApi.ingestIssues.mockResolvedValue({
        ok: true,
        started: ["issue-1"],
        skipped: [],
      });

      renderPage();

      await user.click(screen.getByRole("button", { name: /sync from linear/i }));
      await waitFor(() => expect(screen.getByText("Fix thing")).toBeDefined());

      await user.click(screen.getByRole("button", { name: /start 1 run/i }));

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      await waitFor(() => {
        expect(screen.getByText("Started 1 run")).toBeDefined();
      });
      expect(refetch).toHaveBeenCalled();

      // Auto-dismiss after INGEST_BANNER_AUTO_DISMISS_MS (5000ms)
      await act(async () => {
        vi.advanceTimersByTime(5100);
      });

      await waitFor(() => {
        expect(screen.queryByText("Started 1 run")).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
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
            id: "issue-1",
            title: "Fix thing",
            description: "",
            state: "Todo",
            labels: [],
            priority: 0,
          },
        ],
      });
      mockApi.ingestIssues.mockResolvedValue({
        ok: true,
        started: ["issue-1"],
        skipped: [],
      });

      renderPage();
      await user.click(screen.getByRole("button", { name: /sync from linear/i }));
      await waitFor(() => expect(screen.getByText("Fix thing")).toBeDefined());
      await user.click(screen.getByRole("button", { name: /start 1 run/i }));

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      await waitFor(() => expect(screen.getByText("Started 1 run")).toBeDefined());

      await user.click(screen.getByRole("button", { name: /dismiss/i }));
      expect(screen.queryByText("Started 1 run")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
