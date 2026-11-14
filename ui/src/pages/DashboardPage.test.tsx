import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage.tsx";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/api/client.ts", () => ({
  api: {
    fetchPendingIssues: vi.fn().mockResolvedValue({ issues: [] }),
    ingestIssues: vi.fn(),
  },
}));

vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: () => {},
}));

let capturedSyncDialogProps: {
  open: boolean;
  onIngestComplete?: (s: { started: number; skipped: number }) => void;
  onIngested?: () => void;
  onClose?: () => void;
} = { open: false };

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
    onIngested?: () => void;
    onClose?: () => void;
  }) => {
    capturedSyncDialogProps = props;
    return props.open ? <div>Sync dialog open</div> : null;
  },
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Add login",
    linearIssueUrl: null,
    repo: "agentforge",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/repo",
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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
    mockUseRuns.mockReset();
  });

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();
  });

  it("shows an error message when the fetch fails", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: "server down", refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("server down")).toBeDefined();
  });

  it("renders stat counts broken down by state category", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }),
        makeRun({ id: "r3", state: "Done" }),
        makeRun({ id: "r4", state: "AIBlocked" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("4")).toBeDefined(); // Total
    const activeStat = screen.getAllByText("Active")[0].previousSibling;
    expect(activeStat?.textContent).toBe("1");
  });

  it("filters the runs table when a filter chip is clicked", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active run" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done run" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.getByText("Done run")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.queryByText("Done run")).toBeNull();
  });

  it("resets to showing all runs when the All filter is re-selected", async () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active run" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done run" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Active run")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.getByText("Done run")).toBeDefined();
  });

  it("opens the Linear sync dialog when the sync button is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.queryByText("Sync dialog open")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/ }));

    expect(screen.getByText("Sync dialog open")).toBeDefined();
  });

  it("shows the ingest summary banner when the sync dialog reports a completed ingest", async () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    act(() => {
      capturedSyncDialogProps.onIngestComplete?.({ started: 3, skipped: 1 });
    });

    expect(screen.getByText(/skipped/i)).toBeDefined();
  });

  it("dismisses the ingest summary banner when onDismiss is triggered", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    act(() => {
      capturedSyncDialogProps.onIngestComplete?.({ started: 2, skipped: 0 });
    });
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    await userEvent.click(dismissBtn);

    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", () => {
    vi.useFakeTimers();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    act(() => {
      capturedSyncDialogProps.onIngestComplete?.({ started: 1, skipped: 0 });
    });
    expect(screen.getByRole("status")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("status")).toBeNull();

    vi.useRealTimers();
  });

  it("refetches runs when the sync dialog reports ingested issues", () => {
    const refetch = vi.fn();
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();

    act(() => {
      capturedSyncDialogProps.onIngested?.();
    });

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("closes the sync dialog when the dialog's onClose is invoked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/ }));
    expect(screen.getByText("Sync dialog open")).toBeDefined();

    act(() => {
      capturedSyncDialogProps.onClose?.();
    });

    expect(screen.queryByText("Sync dialog open")).toBeNull();
  });
});
