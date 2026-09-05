import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

// LinearSyncDialog has its own dedicated test file and pulls in useSSE
// (which needs a real EventSource); stub it here so DashboardPage's own
// logic (open/close wiring, onIngested/onIngestComplete callbacks) can be
// exercised in isolation.
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) =>
    props.open ? (
      <div data-testid="sync-dialog">
        <button onClick={props.onClose}>close-dialog</button>
        <button onClick={props.onIngested}>fire-ingested</button>
        <button onClick={() => props.onIngestComplete?.({ started: 2, skipped: 1 })}>
          fire-ingest-complete
        </button>
      </div>
    ) : null,
}));

import { DashboardPage } from "./DashboardPage.tsx";

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
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the loading state", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();
  });

  it("shows the error state", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
  });

  it("renders the runs table and stat counts once loaded", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }),
        makeRun({ id: "r3", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getAllByText("Fix the bug").length).toBe(3);
    // Total stat
    expect(screen.getByText("3")).toBeDefined();
  });

  it("counts a run in an unrecognized state as idle rather than crashing", () => {
    useRunsMock.mockReturnValue({
      runs: [makeRun({ id: "r1", state: "SomeBrandNewState" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    // Total stat should still reflect the one run even though its state
    // isn't in STATE_CATEGORY_MAP.
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("filters runs by category when a filter button is clicked", async () => {
    const user = userEvent.setup();
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Completed one" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("Completed one")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Fix the bug")).toBeNull();
    expect(screen.getByText("Completed one")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("opens the sync dialog, and onClose/onIngested wire through to the hook", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await user.click(screen.getByText("fire-ingested"));
    expect(refetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner on onIngestComplete and auto-dismisses it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByText("fire-ingest-complete"));

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.getByText(/Started 2 runs/)).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5001);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses the ingest summary banner manually", async () => {
    const user = userEvent.setup();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByText("fire-ingest-complete"));
    expect(screen.getByRole("status")).toBeDefined();

    await user.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
