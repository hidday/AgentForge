import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Run } from "@/api/client.ts";

// --- Mock the useRuns hook so the page's own composition/logic is under test ---
const mockUseRuns = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: (...args: unknown[]) => mockUseRuns(...args),
}));

// --- Mock child components with simple stubs that expose the props passed in ---
vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: (props: { runs: Run[]; onAction: () => void }) => (
    <div data-testid="runs-table">
      <span data-testid="runs-table-count">{props.runs.length}</span>
      {props.runs.map((r) => (
        <span key={r.id} data-testid="run-row">
          {r.id}
        </span>
      ))}
      <button onClick={props.onAction}>trigger-onAction</button>
    </div>
  ),
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
        <button onClick={props.onClose}>close-dialog</button>
        <button onClick={props.onIngested}>trigger-ingested</button>
        <button onClick={() => props.onIngestComplete({ started: 3, skipped: 1 })}>
          trigger-ingest-complete
        </button>
      </div>
    ) : (
      <div data-testid="linear-sync-dialog-closed" />
    ),
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: (props: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-summary-banner">
      started:{props.started} skipped:{props.skipped}
      <button onClick={props.onDismiss}>dismiss-banner</button>
    </div>
  ),
}));

import { DashboardPage } from "./DashboardPage.tsx";

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: `issue-${id}`,
    linearIssueIdentifier: `ISS-${id}`,
    linearIssueDescription: null,
    linearIssueTitle: `Title ${id}`,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state,
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
  };
}

function setUseRuns(overrides: Partial<ReturnType<typeof baseUseRuns>>) {
  mockUseRuns.mockReturnValue({ ...baseUseRuns(), ...overrides });
}

function baseUseRuns() {
  return {
    runs: [] as Run[],
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the loading state and does not render the runs table or error", () => {
    setUseRuns({ loading: true });
    render(<DashboardPage />);

    expect(screen.getByText(/loading runs/i)).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders the error state instead of the runs table", () => {
    setUseRuns({ loading: false, error: "Network error" });
    render(<DashboardPage />);

    expect(screen.getByText("Network error")).toBeDefined();
    expect(screen.queryByTestId("runs-table")).toBeNull();
  });

  it("renders an empty RunsTable when there are no runs", () => {
    setUseRuns({ runs: [] });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table-count").textContent).toBe("0");
  });

  it("renders populated runs and passes them to RunsTable", () => {
    const runs = [makeRun("r1", "Todo"), makeRun("r2", "Implementing")];
    setUseRuns({ runs });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table-count").textContent).toBe("2");
    expect(screen.getAllByTestId("run-row")).toHaveLength(2);
  });

  it("computes stats bar counts per state category", () => {
    const runs = [
      makeRun("r1", "Planning"), // active
      makeRun("r2", "Implementing"), // active
      makeRun("r3", "AwaitingPlanApproval"), // waiting
      makeRun("r4", "AIBlocked"), // blocked
      makeRun("r5", "Done"), // done
      makeRun("r6", "UnknownState"), // falls back to idle, not counted in any shown bucket
    ];
    setUseRuns({ runs });
    render(<DashboardPage />);

    // Helper: the stat labels render as <div> siblings; filter buttons render
    // the same text inside a <button>, so disambiguate by tag name.
    function statValueFor(label: string): string | null | undefined {
      const el = screen
        .getAllByText(label)
        .find((e) => e.tagName === "DIV");
      return el?.previousSibling?.textContent;
    }

    // Total reflects all runs including the unknown-state one
    expect(statValueFor("Total")).toBe("6");
    expect(statValueFor("Active")).toBe("2");
    expect(statValueFor("Awaiting")).toBe("1");
    expect(statValueFor("Blocked")).toBe("1");
    expect(statValueFor("Done")).toBe("1");
  });

  it("filters runs by category when a filter button is clicked", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun("r1", "Planning"), // active
      makeRun("r2", "Done"), // done
    ];
    setUseRuns({ runs });
    render(<DashboardPage />);

    expect(screen.getByTestId("runs-table-count").textContent).toBe("2");

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("runs-table-count").textContent).toBe("1");
    expect(screen.getByTestId("run-row").textContent).toBe("r2");

    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByTestId("runs-table-count").textContent).toBe("1");
    expect(screen.getByTestId("run-row").textContent).toBe("r1");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("runs-table-count").textContent).toBe("2");
  });

  it("filters to runs with no matching category label (Blocked/Awaiting) correctly", async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun("r1", "AIBlocked"), // blocked
      makeRun("r2", "HumanClarificationNeeded"), // waiting
    ];
    setUseRuns({ runs });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "Blocked" }));
    expect(screen.getByTestId("runs-table-count").textContent).toBe("1");
    expect(screen.getByTestId("run-row").textContent).toBe("r1");

    await user.click(screen.getByRole("button", { name: "Awaiting Human" }));
    expect(screen.getByTestId("runs-table-count").textContent).toBe("1");
    expect(screen.getByTestId("run-row").textContent).toBe("r2");
  });

  it("opens the LinearSyncDialog when 'Sync from Linear' is clicked, closed by default", async () => {
    const user = userEvent.setup();
    setUseRuns({});
    render(<DashboardPage />);

    expect(screen.getByTestId("linear-sync-dialog-closed")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    expect(screen.getByTestId("linear-sync-dialog")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "close-dialog" }));
    expect(screen.getByTestId("linear-sync-dialog-closed")).toBeDefined();
  });

  it("calls refetch when RunsTable's onAction fires and when LinearSyncDialog's onIngested fires", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    setUseRuns({ refetch });
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "trigger-onAction" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "trigger-ingested" }));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("shows the ingest summary banner after onIngestComplete fires, with correct counts, and it can be dismissed manually", async () => {
    const user = userEvent.setup();
    setUseRuns({});
    render(<DashboardPage />);

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();

    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByRole("button", { name: "trigger-ingest-complete" }));

    const banner = screen.getByTestId("ingest-summary-banner");
    expect(banner.textContent).toContain("started:3");
    expect(banner.textContent).toContain("skipped:1");

    await user.click(screen.getByRole("button", { name: "dismiss-banner" }));
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", () => {
    vi.useFakeTimers();
    setUseRuns({});
    render(<DashboardPage />);

    act(() => {
      screen.getByRole("button", { name: /sync from linear/i }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "trigger-ingest-complete" }).click();
    });

    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });

  it("resets the auto-dismiss timer key when onIngestComplete fires again", () => {
    vi.useFakeTimers();
    setUseRuns({});
    render(<DashboardPage />);

    act(() => {
      screen.getByRole("button", { name: /sync from linear/i }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "trigger-ingest-complete" }).click();
    });
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    // advance partway, then trigger again — banner should still be visible
    // and the timer restarted (not dismissed at the original 5s mark)
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      screen.getByRole("button", { name: "trigger-ingest-complete" }).click();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });
});
