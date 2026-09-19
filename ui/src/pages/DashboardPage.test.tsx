import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import { DashboardPage } from "./DashboardPage.tsx";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: () => {},
}));

vi.mock("@/api/client.ts", () => ({
  api: {
    fetchPendingIssues: vi.fn().mockResolvedValue({ issues: [] }),
    ingestIssues: vi.fn(),
  },
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some issue",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
  });

  it("shows an error message when the runs fetch fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("renders the runs table when loaded successfully", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun()],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Some issue")).toBeDefined();
  });

  it("renders per-category stat counts", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }), // active
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
        makeRun({ id: "r3", state: "AIBlocked" }), // blocked
        makeRun({ id: "r4", state: "Done" }), // done
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("4")).toBeDefined(); // total
    // Each stat value of "1" appears 4 times (active/waiting/blocked/done)
    expect(screen.getAllByText("1").length).toBe(4);
  });

  it("treats a state with no category mapping as idle (not counted in any bucket)", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "r1", state: "SomeUnknownState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // Total is 1, but none of active/waiting/blocked/done buckets increment.
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(4);
  });

  it("filters runs by category when a filter button is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active issue" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done issue" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Active issue")).toBeDefined();
    expect(screen.getByText("Done issue")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByText("Active issue")).toBeDefined();
    expect(screen.queryByText("Done issue")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Active issue")).toBeNull();
    expect(screen.getByText("Done issue")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Active issue")).toBeDefined();
    expect(screen.getByText("Done issue")).toBeDefined();
  });

  it("filters to Awaiting Human and Blocked categories", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "AwaitingPlanApproval", linearIssueTitle: "Waiting issue" }),
        makeRun({ id: "r2", state: "AIBlocked", linearIssueTitle: "Blocked issue" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Awaiting Human" }));
    expect(screen.getByText("Waiting issue")).toBeDefined();
    expect(screen.queryByText("Blocked issue")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
    expect(screen.queryByText("Waiting issue")).toBeNull();
    expect(screen.getByText("Blocked issue")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    renderPage();
    expect(screen.queryByText("Sync from Linear", { selector: "h3" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(await screen.findByText("Sync from Linear", { selector: "h3" })).toBeDefined();
  });

  it("cancelling the sync dialog does not show an ingest summary banner", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await screen.findByText("Sync from Linear", { selector: "h3" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the ingest summary banner after a sync completes, and auto-dismisses it after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api } = await import("@/api/client.ts");
      const mockApi = api as unknown as {
        fetchPendingIssues: ReturnType<typeof vi.fn>;
        ingestIssues: ReturnType<typeof vi.fn>;
      };
      mockApi.fetchPendingIssues.mockResolvedValue({
        issues: [
          {
            id: "issue-a",
            title: "Issue A",
            description: "",
            state: "Todo",
            labels: [],
            priority: 0,
          },
        ],
      });
      mockApi.ingestIssues.mockResolvedValue({
        ok: true,
        started: ["issue-a"],
        skipped: [],
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
      await waitFor(() => expect(screen.getByText("Issue A")).toBeDefined());

      await user.click(screen.getByRole("button", { name: /start 1 run/i }));

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      await waitFor(() => {
        expect(screen.getByRole("status")).toBeDefined();
      });
      expect(screen.getByText(/Started 1 run/)).toBeDefined();

      // Auto-dismiss after INGEST_BANNER_AUTO_DISMISS_MS (5000ms).
      await act(async () => {
        vi.advanceTimersByTime(5100);
      });

      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it("dismisses the ingest summary banner manually via its dismiss button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api } = await import("@/api/client.ts");
      const mockApi = api as unknown as {
        fetchPendingIssues: ReturnType<typeof vi.fn>;
        ingestIssues: ReturnType<typeof vi.fn>;
      };
      mockApi.fetchPendingIssues.mockResolvedValue({
        issues: [
          {
            id: "issue-b",
            title: "Issue B",
            description: "",
            state: "Todo",
            labels: [],
            priority: 0,
          },
        ],
      });
      mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: ["issue-b"] });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
      await waitFor(() => expect(screen.getByText("Issue B")).toBeDefined());
      await user.click(screen.getByRole("button", { name: /start 1 run/i }));

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
      expect(screen.getByText(/skipped 1/)).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 20000);
});
