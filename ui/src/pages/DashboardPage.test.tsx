import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import { useRuns } from "@/hooks/useRuns.ts";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({ useRuns: vi.fn() }));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs }: { runs: Run[] }) => (
    <div data-testid="runs-table">{runs.map((r) => r.id).join(",")}</div>
  ),
}));

let capturedSyncProps: {
  open: boolean;
  onClose: () => void;
  onIngested: () => void;
  onIngestComplete?: (s: { started: number; skipped: number }) => void;
} | null = null;
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => {
    capturedSyncProps = props;
    return <div data-testid="sync-dialog">{props.open ? "open" : "closed"}</div>;
  },
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({
    started,
    skipped,
    onDismiss,
  }: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-banner">
      <button onClick={onDismiss}>dismiss</button>
      {started}/{skipped}
    </div>
  ),
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "i1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
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
    capturedSyncProps = null;
  });

  it("shows a loading indicator while runs are loading", () => {
    vi.mocked(useRuns).mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();
  });

  it("shows an error message when runs fail to load", () => {
    vi.mocked(useRuns).mockReturnValue({
      runs: [],
      loading: false,
      error: "boom",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders the runs table once loaded", () => {
    vi.mocked(useRuns).mockReturnValue({
      runs: [makeRun({ id: "r1" }), makeRun({ id: "r2", state: "Done" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");
  });

  it("shows stat counts by state category", () => {
    vi.mocked(useRuns).mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }),
        makeRun({ id: "r3", state: "AIBlocked" }),
        makeRun({ id: "r4", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("4")).toBeDefined(); // Total
    const ones = screen.getAllByText("1");
    expect(ones.length).toBe(4); // Active, Awaiting, Blocked, Done each 1
  });

  it("counts a run with an unrecognized state as idle", () => {
    vi.mocked(useRuns).mockReturnValue({
      runs: [makeRun({ id: "r1", state: "SomeUnknownState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // Total is 1, and none of the known categories (active/waiting/blocked/done) picked it up.
    expect(screen.getAllByText("1")).toHaveLength(1);
    expect(screen.getAllByText("0")).toHaveLength(4);
  });

  it("filters the runs list by category when a filter button is clicked", () => {
    vi.mocked(useRuns).mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r2");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table").textContent).toBe("r1,r2");
  });

  it("opens the Linear sync dialog when the sync button is clicked", () => {
    vi.mocked(useRuns).mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByTestId("sync-dialog").textContent).toBe("closed");
    fireEvent.click(screen.getByText("Sync from Linear"));
    expect(screen.getByTestId("sync-dialog").textContent).toBe("open");
  });

  it("shows the ingest summary banner after an ingest completes", () => {
    vi.mocked(useRuns).mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByTestId("ingest-banner")).toBeNull();

    act(() => {
      capturedSyncProps!.onIngestComplete?.({ started: 3, skipped: 1 });
    });
    expect(screen.getByTestId("ingest-banner").textContent).toBe("dismiss3/1");
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", () => {
    vi.useFakeTimers();
    vi.mocked(useRuns).mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    act(() => {
      capturedSyncProps!.onIngestComplete?.({ started: 1, skipped: 0 });
    });
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
    vi.useRealTimers();
  });

  it("closes the sync dialog and refetches runs via the dialog callbacks", () => {
    const refetch = vi.fn();
    vi.mocked(useRuns).mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();
    fireEvent.click(screen.getByText("Sync from Linear"));
    expect(screen.getByTestId("sync-dialog").textContent).toBe("open");

    act(() => {
      capturedSyncProps!.onIngested();
    });
    expect(refetch).toHaveBeenCalled();

    act(() => {
      capturedSyncProps!.onClose();
    });
    expect(screen.getByTestId("sync-dialog").textContent).toBe("closed");
  });

  it("dismisses the ingest summary banner when its dismiss action is used", () => {
    vi.mocked(useRuns).mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();
    act(() => {
      capturedSyncProps!.onIngestComplete?.({ started: 2, skipped: 0 });
    });
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    fireEvent.click(screen.getByText("dismiss"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
