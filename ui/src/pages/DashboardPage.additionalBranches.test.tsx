import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useRuns.ts", () => ({
  useRuns: vi.fn(),
}));

vi.mock("@/components/RunsTable.tsx", () => ({
  RunsTable: ({ runs, onAction }: { runs: { id: string; state: string }[]; onAction: () => void }) => (
    <div data-testid="runs-table" data-run-ids={runs.map((r) => r.id).join(",")}>
      <button onClick={onAction}>trigger-action</button>
    </div>
  ),
}));

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="linear-sync-dialog">
        <button onClick={() => onIngestComplete({ started: 2, skipped: 0 })}>
          complete-ingest
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/IngestSummaryBanner.tsx", () => ({
  IngestSummaryBanner: ({
    started,
    skipped,
  }: {
    started: number;
    skipped: number;
    onDismiss: () => void;
  }) => (
    <div data-testid="ingest-summary-banner">
      {started} started, {skipped} skipped
    </div>
  ),
}));

import { useRuns } from "@/hooks/useRuns.ts";
import { DashboardPage } from "./DashboardPage.tsx";

const mockUseRuns = useRuns as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<{ id: string; state: string }> = {}) {
  return {
    id: "run-1",
    repo: "org/repo",
    state: "Planning",
    linearIssueId: "issue-1",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DashboardPage additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a run with an unrecognized state under the 'idle' category fallback", () => {
    const runs = [makeRun({ id: "r1", state: "SomeUnknownState" })];
    mockUseRuns.mockReturnValue({ runs, loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);

    // None of the named categories (Active/Awaiting/Blocked/Done) should
    // count this run; only "Total" reflects it.
    const totalLabel = screen.getByText("Total");
    expect(totalLabel.previousElementSibling?.textContent).toBe("1");

    const activeLabel = screen.getByText("Active", { selector: "div" });
    expect(activeLabel.previousElementSibling?.textContent).toBe("0");
    const awaitingLabel = screen.getByText("Awaiting");
    expect(awaitingLabel.previousElementSibling?.textContent).toBe("0");
    const blockedLabel = screen.getByText("Blocked", { selector: "div" });
    expect(blockedLabel.previousElementSibling?.textContent).toBe("0");
    const doneLabel = screen.getByText("Done", { selector: "div" });
    expect(doneLabel.previousElementSibling?.textContent).toBe("0");
  });

  it("auto-dismisses the ingest summary banner after the timeout elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockUseRuns.mockReturnValue({ runs: [], loading: false, error: null, refetch: vi.fn() });

    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: /sync from linear/i }));
    await user.click(screen.getByText("complete-ingest"));

    expect(screen.getByTestId("ingest-summary-banner")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.queryByTestId("ingest-summary-banner")).toBeNull();
  });
});
