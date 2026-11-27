import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

// Stub LinearSyncDialog so DashboardPage's own wiring (open state, callback
// plumbing into ingestSummary) can be exercised without re-testing the
// dialog's internals (covered by LinearSyncDialog.test.tsx).
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngested,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => (
    <div data-testid="linear-sync-dialog" data-open={open ? "true" : "false"}>
      <button onClick={onClose}>close-dialog</button>
      <button onClick={onIngested}>trigger-ingested</button>
      <button onClick={() => onIngestComplete?.({ started: 3, skipped: 1 })}>
        trigger-complete
      </button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
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
    useRunsMock.mockReset();
  });

  it("shows the loading indicator and does not render the runs table while loading", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByText(/no runs found/i)).toBeNull();
  });

  it("shows the error message when the hook reports an error", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByText(/loading runs/i)).toBeNull();
  });

  it("renders the empty state through RunsTable when there are no runs", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/no runs found/i)).toBeDefined();
    // Stats bar should show all-zero counts
    expect(screen.getByText("Total")).toBeDefined();
  });

  it("renders runs, computes per-category stats, and lists each run's issue title", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active one" }),
      makeRun({ id: "r2", state: "AwaitingPlanApproval", linearIssueTitle: "Waiting one" }),
      makeRun({ id: "r3", state: "AIBlocked", linearIssueTitle: "Blocked one" }),
      makeRun({ id: "r4", state: "Done", linearIssueTitle: "Done one" }),
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Active one")).toBeDefined();
    expect(screen.getByText("Waiting one")).toBeDefined();
    expect(screen.getByText("Blocked one")).toBeDefined();
    expect(screen.getByText("Done one")).toBeDefined();

    // Stats bar: Total=4, Active=1, Awaiting=1, Blocked=1, Done=1
    const totalStat = screen.getByText("Total").previousSibling as HTMLElement;
    expect(totalStat.textContent).toBe("4");
  });

  it("falls back to the 'idle' category for a run whose state isn't in the map", () => {
    const runs = [makeRun({ id: "r1", state: "SomeUnknownState" })];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // Doesn't blow up, and the run isn't counted in any of the four named buckets.
    // "Active"/"Done" etc. also appear as filter button labels, so pick the
    // plain <div> stat label rather than the <button>.
    function statLabel(text: string): HTMLElement {
      const el = screen
        .getAllByText(text)
        .find((e) => e.tagName === "DIV");
      if (!el) throw new Error(`stat label div for "${text}" not found`);
      return el;
    }
    const activeStat = statLabel("Active").previousSibling as HTMLElement;
    const waitingStat = statLabel("Awaiting").previousSibling as HTMLElement;
    const blockedStat = statLabel("Blocked").previousSibling as HTMLElement;
    const doneStat = statLabel("Done").previousSibling as HTMLElement;
    expect(activeStat.textContent).toBe("0");
    expect(waitingStat.textContent).toBe("0");
    expect(blockedStat.textContent).toBe("0");
    expect(doneStat.textContent).toBe("0");
  });

  it("filters the visible runs when a filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active one" }),
      makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done one" }),
    ];
    useRunsMock.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Active one")).toBeDefined();
    expect(screen.getByText("Done one")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByText("Active one")).toBeDefined();
    expect(screen.queryByText("Done one")).toBeNull();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Done one")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it", async () => {
    const user = userEvent.setup();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const dialog = screen.getByTestId("linear-sync-dialog");
    expect(dialog.getAttribute("data-open")).toBe("false");

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(dialog.getAttribute("data-open")).toBe("true");

    await user.click(screen.getByText("close-dialog"));
    expect(dialog.getAttribute("data-open")).toBe("false");
  });

  it("calls refetch when the dialog reports onIngested", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    renderPage();

    await user.click(screen.getByText("trigger-ingested"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after onIngestComplete and auto-dismisses it after 5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    await user.click(screen.getByText("trigger-complete"));

    expect(screen.getByRole("status").textContent).toContain("Started 3 runs");
    expect(screen.getByRole("status").textContent).toContain("skipped 1");

    await act(async () => {
      vi.advanceTimersByTime(5001);
    });

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });

    vi.useRealTimers();
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", async () => {
    const user = userEvent.setup();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    await user.click(screen.getByText("trigger-complete"));
    expect(screen.getByRole("status")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
