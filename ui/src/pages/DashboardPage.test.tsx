import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
      {runs.map((r) => (
        <span key={r.id} data-testid="run-row">
          {r.id}
        </span>
      ))}
      <button onClick={onAction}>trigger-action</button>
    </div>
  ),
}));

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
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={onIngested}>fire-ingested</button>
        <button onClick={() => onIngestComplete?.({ started: 3, skipped: 1 })}>
          fire-ingest-complete
        </button>
      </div>
    ) : (
      <div data-testid="sync-dialog-closed" />
    ),
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

// Several stat labels ("Active", "Blocked", "Done") share their text with a
// filter button, so getByText alone is ambiguous. Stat labels always render
// as the second <div> child of a stat card; find that specific node.
function statValue(label: string): string | null {
  const matches = screen.getAllByText(label);
  const statLabel = matches.find((el) => el.tagName === "DIV");
  if (!statLabel) throw new Error(`no stat label div found for "${label}"`);
  return (statLabel.previousSibling as HTMLElement | null)?.textContent ?? null;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when fetching runs fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network unreachable",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Network unreachable")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the empty state via RunsTable when there are no runs", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("runs-count").textContent).toBe("0");
    // Stat bar should reflect zero across the board.
    expect(statValue("Total")).toBe("0");
  });

  it("computes per-category counts and renders all runs by default", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }), // active
      makeRun({ id: "r2", state: "AwaitingPlanApproval" }), // waiting
      makeRun({ id: "r3", state: "AIBlocked" }), // blocked
      makeRun({ id: "r4", state: "Done" }), // done
      makeRun({ id: "r5", state: "SomeUnknownState" }), // falls back to idle
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("runs-count").textContent).toBe("5");
    expect(statValue("Active")).toBe("1");
    expect(statValue("Awaiting")).toBe("1");
    expect(statValue("Blocked")).toBe("1");
    expect(statValue("Done")).toBe("1");
    expect(statValue("Total")).toBe("5");
  });

  it("filters runs client-side when a filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: "r1", state: "Implementing" }), // active
      makeRun({ id: "r2", state: "Done" }), // done
    ];
    mockUseRuns.mockReturnValue({
      runs,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await user.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByTestId("runs-count").textContent).toBe("1");
    expect(screen.getByTestId("run-row").textContent).toBe("r1");

    // Switching back to "All" restores the full list.
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("opens and closes the sync dialog", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("sync-dialog-closed")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "close-dialog" }));
    expect(screen.getByTestId("sync-dialog-closed")).toBeDefined();
  });

  it("refetches runs when the sync dialog reports an ingest", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });

    renderPage();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingested" }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the ingest summary banner and auto-dismisses it after 5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingest-complete" }));

    const banner = screen.getByRole("status");
    expect(within(banner).getByText(/started 3 runs/i)).toBeDefined();
    expect(within(banner).getByText(/skipped 1/i)).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses the ingest summary banner manually via its dismiss button", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "fire-ingest-complete" }));

    expect(screen.getByRole("status")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("passes refetch through to RunsTable's onAction", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({
      runs: [makeRun()],
      loading: false,
      error: null,
      refetch,
    });

    renderPage();
    await user.click(screen.getByRole("button", { name: "trigger-action" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
