import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import type { IngestSummary } from "@/components/LinearSyncDialog.tsx";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: IngestSummary) => void;
  }) => (
    <div data-testid="linear-sync-dialog" data-open={props.open}>
      <button onClick={props.onClose}>mock-close-dialog</button>
      <button onClick={props.onIngested}>mock-on-ingested</button>
      <button onClick={() => props.onIngestComplete?.({ started: 2, skipped: 1 })}>
        mock-ingest-complete
      </button>
    </div>
  ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-summary-banner">
      Started {props.started}, Skipped {props.skipped}
      <button onClick={props.onDismiss}>mock-dismiss-banner</button>
    </div>
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";
import { DashboardPage } from "./DashboardPage.tsx";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

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
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:10:00Z",
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
  });

  it("shows an error message when the hook reports an error", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("renders the runs table with fetched runs", () => {
    mockUseRuns.mockReturnValue({
      runs: [makeRun()],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("computes and displays stats counts by category", () => {
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

    // "Active", "Blocked", and "Done" labels are shared with the filter
    // buttons below, so scope assertions to the stats grid specifically.
    const statsGrid = screen.getByText("Total").closest(".grid")!;
    expect(statsGrid.textContent).toContain("4Total");
    expect(statsGrid.textContent).toContain("1Active");
    expect(statsGrid.textContent).toContain("1Awaiting");
    expect(statsGrid.textContent).toContain("1Blocked");
    expect(statsGrid.textContent).toContain("1Done");
  });

  it("filters the visible runs when a filter button is clicked", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByText("Active issue")).toBeNull();
    expect(screen.getByText("Done issue")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Active issue")).toBeDefined();
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("true");
  });

  it("closes the dialog when its onClose is invoked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "mock-close-dialog" }));
    expect(screen.getByTestId("linear-sync-dialog").dataset.open).toBe("false");
  });

  it("calls refetch when the dialog reports onIngested", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "mock-on-ingested" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete, then auto-dismisses it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();

    await user.click(screen.getByRole("button", { name: "mock-ingest-complete" }));

    expect(screen.getByTestId("ingest-summary-banner").textContent).toContain("Started 2");
    expect(screen.getByTestId("ingest-summary-banner").textContent).toContain("Skipped 1");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("dismisses the ingest summary banner immediately when its onDismiss fires", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "mock-ingest-complete" }));
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "mock-dismiss-banner" }));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });
});
