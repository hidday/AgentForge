import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage.tsx";
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

// LinearSyncDialog calls useSSE unconditionally even when closed, which would
// otherwise construct a real EventSource under jsdom. Mock it out — its own
// behavior is covered by LinearSyncDialog.test.tsx.
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="linear-sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={() => onIngestComplete?.({ started: 2, skipped: 1 })}>
          complete-ingest
        </button>
      </div>
    ) : null,
}));

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

function makeRun(overrides: Partial<Run>): Run {
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
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
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
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows a loading state while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();
  });

  it("shows an error message when the runs fetch fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("renders the runs table once loaded", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun({ id: "run-1", linearIssueTitle: "My issue" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("My issue")).toBeDefined();
  });

  it("computes and displays per-category stat counts", () => {
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

    // "Active", "Blocked" and "Done" labels are ambiguous with the filter
    // buttons below, so take the first match (the stats bar renders first).
    expect(screen.getByText("Total").previousSibling?.textContent).toBe("4");
    expect(screen.getAllByText("Active")[0]!.previousSibling?.textContent).toBe("1");
    expect(screen.getByText("Awaiting").previousSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Blocked")[0]!.previousSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Done")[0]!.previousSibling?.textContent).toBe("1");
  });

  it("filters the runs table by category when a filter button is clicked", async () => {
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
  });

  it("switching back to 'All' restores the full run list", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Done", linearIssueTitle: "Done issue" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Done issue")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Done issue")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    renderPage();
    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();
  });

  it("closes the Linear sync dialog via its onClose callback", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner after onIngestComplete fires, and it auto-dismisses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPage();

      await user.click(screen.getByRole("button", { name: /sync from linear/i }));
      await user.click(screen.getByText("complete-ingest"));

      const status = screen.getByRole("status");
      expect(status.textContent).toContain("Started 2 runs");
      expect(status.textContent).toContain("skipped 1");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5001);
      });

      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("complete-ingest"));

    expect(screen.getByRole("status")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
