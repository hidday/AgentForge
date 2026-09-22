import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage.tsx";
import type { Run } from "@/api/client.ts";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete?: (s: { started: number; skipped: number }) => void;
  }) => {
    if (!props.open) return null;
    return (
      <div data-testid="sync-dialog-stub">
        <button onClick={props.onClose}>stub-close</button>
        <button onClick={() => props.onIngested()}>stub-ingested</button>
        <button
          onClick={() => props.onIngestComplete?.({ started: 3, skipped: 1 })}
        >
          stub-complete
        </button>
      </div>
    );
  },
}));

import { useRuns } from "@/hooks/useRuns.ts";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/repo",
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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator and no table while runs are loading", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Loading runs...")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an error message and no table when fetching runs fails", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: "Failed to fetch runs",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Failed to fetch runs")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the empty-runs state via RunsTable when there are no runs", () => {
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders per-category stat counts and every run row for a populated list", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", linearIssueTitle: "Active one", state: "Implementing" }),
        makeRun({ id: "r2", linearIssueTitle: "Waiting one", state: "AwaitingPlanApproval" }),
        makeRun({ id: "r3", linearIssueTitle: "Blocked one", state: "AIBlocked" }),
        makeRun({ id: "r4", linearIssueTitle: "Done one", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Active one")).toBeDefined();
    expect(screen.getByText("Waiting one")).toBeDefined();
    expect(screen.getByText("Blocked one")).toBeDefined();
    expect(screen.getByText("Done one")).toBeDefined();

    // Total stat card (".rounded-lg" is the stat card wrapper; the label
    // itself sits in an inner div, so climb past it). "Active"/"Blocked"/
    // "Done" labels also appear as filter-bar button text, so pick the
    // first match, which is the stats bar (rendered before the filters).
    const totalCard = screen.getByText("Total").closest(".rounded-lg");
    expect(within(totalCard as HTMLElement).getByText("4")).toBeDefined();

    const activeCard = screen.getAllByText("Active")[0]!.closest(".rounded-lg");
    expect(within(activeCard as HTMLElement).getByText("1")).toBeDefined();

    const blockedCard = screen.getAllByText("Blocked")[0]!.closest(".rounded-lg");
    expect(within(blockedCard as HTMLElement).getByText("1")).toBeDefined();

    const doneCard = screen.getAllByText("Done")[0]!.closest(".rounded-lg");
    expect(within(doneCard as HTMLElement).getByText("1")).toBeDefined();
  });

  it("falls back to the 'idle' category (uncounted in the stat cards) for an unrecognized run state", () => {
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", linearIssueTitle: "Known state", state: "Implementing" }),
        makeRun({ id: "r2", linearIssueTitle: "Mystery state", state: "SomeFutureState" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // Total counts both runs...
    const totalCard = screen.getByText("Total").closest(".rounded-lg");
    expect(within(totalCard as HTMLElement).getByText("2")).toBeDefined();
    // ...but the unrecognized state doesn't bump Active/Awaiting/Blocked/Done,
    // since it falls back to the uncounted "idle" category.
    const activeCard = screen.getAllByText("Active")[0]!.closest(".rounded-lg");
    expect(within(activeCard as HTMLElement).getByText("1")).toBeDefined();
    const doneCard = screen.getAllByText("Done")[0]!.closest(".rounded-lg");
    expect(within(doneCard as HTMLElement).getByText("0")).toBeDefined();

    // Both rows still render in the table regardless of category.
    expect(screen.getByText("Known state")).toBeDefined();
    expect(screen.getByText("Mystery state")).toBeDefined();
  });

  it("filters the runs table when a category filter button is clicked", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [
        makeRun({ id: "r1", linearIssueTitle: "Active one", state: "Implementing" }),
        makeRun({ id: "r2", linearIssueTitle: "Done one", state: "Done" }),
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Active one")).toBeDefined();
    expect(screen.getByText("Done one")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByText("Active one")).toBeNull();
    expect(screen.getByText("Done one")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Active one")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked, and closes it via onClose", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByTestId("sync-dialog-stub")).toBeNull();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("sync-dialog-stub")).toBeDefined();

    await user.click(screen.getByText("stub-close"));
    expect(screen.queryByTestId("sync-dialog-stub")).toBeNull();
  });

  it("calls refetch when the dialog reports onIngested", async () => {
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
    await user.click(screen.getByText("stub-ingested"));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the ingest summary banner on onIngestComplete and auto-dismisses it after 5s", async () => {
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
    await user.click(screen.getByText("stub-complete"));

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Started 3 runs");
    expect(status.textContent).toContain("skipped 1");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses the ingest summary banner immediately when its dismiss button is clicked", async () => {
    const user = userEvent.setup();
    mockUseRuns.mockReturnValue({
      runs: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByText("stub-complete"));

    expect(screen.getByRole("status")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
