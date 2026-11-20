import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinearSyncDialog } from "./LinearSyncDialog.tsx";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

// Additive coverage for LinearSyncDialog.tsx. See LinearSyncDialog.test.tsx
// for the main auto-close/error suite; this file closes the remaining gaps
// (select-all / per-row toggling, priority/project/label rendering branches,
// the empty state, fetch-error path, the closed-dialog early return, the
// unmount-with-pending-timer cleanup, and two re-entrant maybeAutoClose
// branches) without touching the existing file.

vi.mock("@/api/client.ts", () => ({
  api: {
    fetchPendingIssues: vi.fn(),
    ingestIssues: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  fetchPendingIssues: ReturnType<typeof vi.fn>;
  ingestIssues: ReturnType<typeof vi.fn>;
};

const issueA = {
  id: "issue-a",
  title: "First issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 2,
};

const issueB = {
  id: "issue-b",
  title: "Second issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 2,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog – additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing and fetches nothing while closed", () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows the empty state and no footer action when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/No pending issues found/i)).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("shows an error message when fetchPendingIssues rejects, and retries via the refresh button", async () => {
    mockApi.fetchPendingIssues.mockRejectedValueOnce(new Error("Linear API down"));
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Linear API down/i)).toBeDefined();
    });

    mockApi.fetchPendingIssues.mockResolvedValueOnce({ issues: [issueA] });
    const refreshBtn = screen.getByTitle("Refresh");
    await userEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByText(issueA.title)).toBeDefined();
    });
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic error message when fetchPendingIssues rejects with a non-Error", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("boom");
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch issues/i)).toBeDefined();
    });
  });

  it("'Select all' deselects and reselects every issue, updating the Start button count", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(true);

    await userEvent.click(selectAllCheckbox);
    expect(screen.getByRole("button", { name: /^start 0 run$/i })).toBeDefined();
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(false);

    await userEvent.click(selectAllCheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggling a single issue's checkbox updates the selection count and singularizes 'Run'", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const rowCheckboxes = screen
      .getAllByRole("checkbox")
      .filter((el) => el !== screen.getByRole("checkbox", { name: /select all/i }));
    expect(rowCheckboxes).toHaveLength(2);

    await userEvent.click(rowCheckboxes[0]);

    // Singular form ("Run", not "Runs") when exactly one issue is selected.
    const startBtn = screen.getByRole("button", { name: /^start 1 run$/i });
    expect(startBtn).toBeDefined();

    await userEvent.click(rowCheckboxes[0]);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("falls back to the 'None' priority label for an issue with an unmapped priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }],
    });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("None")).toBeDefined();
  });

  it("renders a project badge when the issue has a project, and issue labels as chips", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, project: "Core Platform", labels: ["bug", "p1"] }],
    });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("p1")).toBeDefined();
  });

  it("does not render a project badge when the issue has no project", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.queryByText("Core Platform")).toBeNull();
  });

  it("clears a pending min-loader close timer on unmount so it never fires afterward", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Both issues observed quickly, well inside MIN_LOADER_MS — this
    // schedules (but does not fire) the delayed-close timer.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    expect(onClose).not.toHaveBeenCalled();

    unmount();

    // If the timer weren't cleared, advancing past MIN_LOADER_MS now would
    // still invoke onClose via the (unmounted) closure. It must not.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-fires a delayed close attempt once already scheduled, without double-scheduling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    let resolveIngest!: (v: { ok: boolean; started: string[]; skipped: string[] }) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((res) => {
        resolveIngest = res;
      }),
    );

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Both seen well before MIN_LOADER_MS elapses -> schedules the delayed
    // close timer (minDelayTimerRef gets set).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // The HTTP response now lands, settling the ingest while a close is
    // already scheduled and MIN_LOADER_MS still hasn't elapsed — this hits
    // the "already scheduled" early-return branch instead of scheduling a
    // second timer.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id, issueB.id], skipped: [] });
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("reports the authoritative counts a second time once the HTTP response settles after an SSE-driven close", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    let resolveIngest!: (v: { ok: boolean; started: string[]; skipped: string[] }) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((res) => {
        resolveIngest = res;
      }),
    );

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={onIngested}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Advance well past MIN_LOADER_MS first, so when SSE later confirms
    // every issue, maybeAutoClose closes immediately (closedRef becomes
    // true) while the ingestIssues HTTP call is still pending.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // The HTTP response now resolves after the dialog already auto-closed.
    // handleIngest's own maybeAutoClose() call is a no-op (closedRef is
    // already true), but it still reports the authoritative counts once
    // more via the dedicated closedRef-already-true path.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    expect(onIngested).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 1 });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores run:created SSE events unrelated to the current ingest (no issueId, wrong type, or not pending)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Wrong event type: ignored outright.
    fireSSE({ type: "run:state-changed", runId: "run-x" });
    // Missing issueId: ignored.
    fireSSE({ type: "run:created", runId: "run-x" });
    // issueId not among the pending set: ignored.
    fireSSE({ type: "run:created", runId: "run-x", issueId: "some-other-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears a pending min-loader close timer when the dialog is closed and reopened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Both seen well inside MIN_LOADER_MS — schedules (but doesn't fire) the
    // delayed-close timer.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // Close and reopen while that timer is still pending — the "open"
    // effect must clear it as part of resetting ingest-tracking state.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // The stale timer from the previous cycle must not have fired.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onIngested when the ingest completes with zero started runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onIngested = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [issueA.id, issueB.id] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={onIngested} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onIngested).not.toHaveBeenCalled();
    });
  });
});
