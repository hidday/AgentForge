import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const mockUseRuns = vi.fn();

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => mockUseRuns(),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    props.open ? (
      <div data-testid="linear-sync-dialog">
        <button onClick={() => props.onIngestComplete({ started: 2, skipped: 1 })}>
          Simulate Ingest Complete
        </button>
        <button onClick={props.onClose}>Close Dialog</button>
      </div>
    ) : null,
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run> & Pick<Run, "id" | "state">): Run {
  return {
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some issue",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
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

  it("shows a loading indicator while runs are loading", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
  });

  it("shows an error message when the fetch fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("renders the runs table and stats bar once loaded", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active run" }),
      makeRun({ id: "r2", state: "AwaitingPlanApproval", linearIssueTitle: "Waiting run" }),
      makeRun({ id: "r3", state: "AIBlocked", linearIssueTitle: "Blocked run" }),
      makeRun({ id: "r4", state: "Done", linearIssueTitle: "Done run" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.getByText("Waiting run")).toBeDefined();
    expect(screen.getByText("Blocked run")).toBeDefined();
    expect(screen.getByText("Done run")).toBeDefined();

    // Total stat should equal 4
    const totalLabel = screen.getByText("Total");
    const totalValue = totalLabel.previousElementSibling;
    expect(totalValue?.textContent).toBe("4");
  });

  it("filters the runs table by state category when a filter button is clicked", async () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active run" }),
      makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done run" }),
    ];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("Active run")).toBeDefined();
    expect(screen.getByText("Done run")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByText("Active run")).toBeNull();
    expect(screen.getByText("Done run")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();
  });

  it("shows the ingest summary banner after onIngestComplete fires, with correct counts", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await userEvent.click(screen.getByText("Simulate Ingest Complete"));

    expect(screen.getByText(/Started 2 runs/)).toBeDefined();
    expect(screen.getByText(/skipped 1/)).toBeDefined();
  });

  it("closes the sync dialog via its onClose callback", async () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("Close Dialog"));
    expect(screen.queryByTestId("linear-sync-dialog")).toBeNull();
  });

  it("shows the empty runs state when there are no runs", () => {
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/No runs found/i)).toBeDefined();
  });
});
