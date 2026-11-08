import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: Run[]; onAction?: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-count">{runs.length}</span>
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
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={onClose}>close-dialog</button>
        <button onClick={onIngested}>ingested</button>
        <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
          complete-ingest
        </button>
      </div>
    ) : null,
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
      started={started} skipped={skipped}
      <button onClick={onDismiss}>dismiss-banner</button>
    </div>
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
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
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
    vi.useRealTimers();
  });

  it("shows the loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the runs table with all runs when filter is 'all'", () => {
    useRunsMock.mockReturnValue({
      runs: [makeRun(), makeRun({ id: "run-2", state: "Done" })],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("computes and displays per-category stat counts, falling back to 'idle' for an unmapped state", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }),
        makeRun({ id: "r3", state: "AIBlocked" }),
        makeRun({ id: "r4", state: "Done" }),
        makeRun({ id: "r5", state: "SomeUnmappedState" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderPage();
    const statValues = Array.from(
      container.querySelectorAll(".grid.grid-cols-5 .text-2xl"),
    ).map((el) => el.textContent);
    // Order: Total, Active, Awaiting, Blocked, Done
    expect(statValues).toEqual(["5", "1", "1", "1", "1"]);
  });

  it("filters the runs passed to RunsTable when a filter button is clicked", async () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("runs-count").textContent).toBe("2");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-count").textContent).toBe("2");
  });

  it("opens the sync dialog when 'Sync from Linear' is clicked", async () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("sync-dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-dialog"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("calls refetch when RunsTable reports an action", async () => {
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({
      runs: [makeRun()],
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    await userEvent.click(screen.getByText("trigger-action"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner after an ingest completes, and dismiss hides it", async () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await userEvent.click(screen.getByText("complete-ingest"));

    const banner = screen.getByTestId("ingest-banner");
    expect(banner.textContent).toContain("started=2");
    expect(banner.textContent).toContain("skipped=1");

    await userEvent.click(screen.getByText("dismiss-banner"));
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await user.click(screen.getByText("complete-ingest"));
    expect(screen.getByTestId("ingest-banner")).toBeDefined();

    vi.advanceTimersByTime(5000);
    await waitFor(() => expect(screen.queryByTestId("ingest-banner")).toBeNull());
    vi.useRealTimers();
  });

  it("calls refetch when the sync dialog reports ingested runs", async () => {
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch,
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await userEvent.click(screen.getByText("ingested"));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
