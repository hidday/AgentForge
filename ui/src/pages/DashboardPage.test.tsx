import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: () => useRunsMock(),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
          finish-sync
        </button>
        <button onClick={onClose}>close-sync</button>
      </div>
    ) : null,
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "An issue",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "main",
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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

  it("shows a loading indicator while runs are loading", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();
  });

  it("shows an error message when fetching runs fails", () => {
    useRunsMock.mockReturnValue({
      runs: [],
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("renders stat counts per state category, treating an unmapped state as idle", () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "Done" }),
        makeRun({ id: "r3", state: "Done" }),
        makeRun({ id: "r4", state: "SomeUnmappedState" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderPage();
    const statsGrid = container.querySelector(".grid-cols-5") as HTMLElement;
    expect(within(statsGrid).getByText("Total").previousElementSibling?.textContent).toBe("4");
    expect(within(statsGrid).getByText("Active").previousElementSibling?.textContent).toBe("1");
    expect(within(statsGrid).getByText("Done").previousElementSibling?.textContent).toBe("2");
  });

  it("filters the runs table by category when a filter button is clicked", async () => {
    useRunsMock.mockReturnValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active one" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done one" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Active one")).toBeDefined();
    expect(screen.getByText("Done one")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByText("Active one")).toBeNull();
    expect(screen.getByText("Done one")).toBeDefined();
  });

  it("opens the Linear sync dialog and shows the ingest summary banner after a sync completes", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByText("Sync from Linear"));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("finish-sync"));
    expect(screen.getByText(/2 run/i)).toBeDefined();
  });

  it("closes the sync dialog via its onClose callback", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByText("Sync from Linear"));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();

    await userEvent.click(screen.getByText("close-sync"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("dismisses the ingest summary banner when its dismiss button is clicked", async () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });
    renderPage();

    await userEvent.click(screen.getByText("Sync from Linear"));
    await userEvent.click(screen.getByText("finish-sync"));
    expect(screen.getByText(/2 run/i)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/2 run/i)).toBeNull();
  });
});
