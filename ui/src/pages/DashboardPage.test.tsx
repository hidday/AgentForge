import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: (...args: unknown[]) => useRunsMock(...args),
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
    return props.open ? <div data-testid="sync-dialog" /> : null;
  },
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
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
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
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
    capturedSyncProps = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
  });

  it("shows an error message when the hook reports an error", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network down",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network down")).toBeDefined();
  });

  it("renders the runs table with fetched runs and correct stats", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "Done" }),
        makeRun({ id: "r3", state: "AIBlocked" }),
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

  it("filters runs by category when a filter button is clicked", async () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Done", linearIssueTitle: "Done issue" }),
        makeRun({ id: "r2", state: "AIBlocked", linearIssueTitle: "Blocked issue" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Done issue")).toBeDefined();
    expect(screen.getByText("Blocked issue")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));

    expect(screen.queryByText("Done issue")).toBeNull();
    expect(screen.getByText("Blocked issue")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("closes the Linear sync dialog when its onClose callback fires", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    act(() => {
      capturedSyncProps!.onClose();
    });
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("shows the ingest summary banner after onIngestComplete fires, then auto-dismisses it", async () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    act(() => {
      capturedSyncProps!.onIngestComplete({ started: 2, skipped: 1 });
    });

    expect(screen.getByText("Started 2 runs")).toBeDefined();
    expect(screen.getByText(", skipped 1")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Started 2 runs")).toBeNull();
  });

  it("dismisses the ingest summary banner when its dismiss button is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    act(() => {
      capturedSyncProps!.onIngestComplete({ started: 1, skipped: 0 });
    });

    expect(screen.getByText("Started 1 run")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByText("Started 1 run")).toBeNull();
  });
});
