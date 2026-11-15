import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage.tsx";
import type { Run } from "@/api/client.ts";

let mockUseRuns: {
  runs: Run[];
  loading: boolean;
  error: string | null;
  refetch: ReturnType<typeof vi.fn>;
};
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns,
}));

let capturedSyncProps: {
  open: boolean;
  onClose: () => void;
  onIngested: () => void;
  onIngestComplete: (s: { started: number; skipped: number }) => void;
} | null = null;

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) => {
    capturedSyncProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="sync-dialog-stub">
        <button onClick={props.onClose}>stub-close</button>
        <button onClick={props.onIngested}>stub-ingested</button>
        <button onClick={() => props.onIngestComplete({ started: 3, skipped: 1 })}>
          stub-complete
        </button>
      </div>
    );
  },
}));

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: overrides.id ?? "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some issue",
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
    workingDirectory: "/work",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
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
    capturedSyncProps = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns = { runs: [], loading: true, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
  });

  it("shows the error message instead of the table when the fetch failed", () => {
    mockUseRuns = { runs: [], loading: false, error: "Boom", refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("Boom")).toBeDefined();
    expect(screen.queryByText(/no runs found/i)).toBeNull();
  });

  it("shows the runs table (empty state) when there are no runs and no error", () => {
    mockUseRuns = { runs: [], loading: false, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(/no runs found/i)).toBeDefined();
  });

  it("computes per-category stat counts from the runs list", () => {
    mockUseRuns = {
      runs: [
        makeRun({ id: "r1", state: "Implementing" }), // active
        makeRun({ id: "r2", state: "AIReview" }), // active
        makeRun({ id: "r3", state: "AwaitingPlanApproval" }), // waiting
        makeRun({ id: "r4", state: "AIBlocked" }), // blocked
        makeRun({ id: "r5", state: "Done" }), // done
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    const stats = screen.getByText("Total").closest("div")!.parentElement!;
    expect(stats.textContent).toContain("5");

    const activeCard = screen.getByText("Active", { selector: "div" }).parentElement!;
    expect(activeCard.textContent).toContain("2");

    const blockedCard = screen.getByText("Blocked", { selector: "div" }).parentElement!;
    expect(blockedCard.textContent).toContain("1");

    const doneCard = screen.getByText("Done", { selector: "div" }).parentElement!;
    expect(doneCard.textContent).toContain("1");
  });

  it("filters the visible runs by category when a filter button is clicked", async () => {
    mockUseRuns = {
      runs: [
        makeRun({ id: "r1", state: "Done", linearIssueTitle: "Done issue" }),
        makeRun({ id: "r2", state: "AIBlocked", linearIssueTitle: "Blocked issue" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderPage();

    expect(screen.getByText("Done issue")).toBeDefined();
    expect(screen.getByText("Blocked issue")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));

    expect(screen.queryByText("Done issue")).toBeNull();
    expect(screen.getByText("Blocked issue")).toBeDefined();
  });

  it("opens the Linear sync dialog from the header button and closes it via onClose", async () => {
    mockUseRuns = { runs: [], loading: false, error: null, refetch: vi.fn() };
    renderPage();

    expect(capturedSyncProps?.open).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(capturedSyncProps?.open).toBe(true);

    await userEvent.click(screen.getByText("stub-close"));
    expect(capturedSyncProps?.open).toBe(false);
  });

  it("refetches runs when the sync dialog reports ingested runs", async () => {
    const refetch = vi.fn();
    mockUseRuns = { runs: [], loading: false, error: null, refetch };
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("stub-ingested"));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete and auto-dismisses it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUseRuns = { runs: [], loading: false, error: null, refetch: vi.fn() };
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("stub-complete"));

    expect(screen.getByRole("status").textContent).toContain("Started 3 runs");
    expect(screen.getByRole("status").textContent).toContain("skipped 1");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUseRuns = { runs: [], loading: false, error: null, refetch: vi.fn() };
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sync from linear/i }));
    await userEvent.click(screen.getByText("stub-complete"));

    expect(screen.getByRole("status")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByRole("status")).toBeNull();
  });
});
