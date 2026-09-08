import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinearSyncDialog } from "./LinearSyncDialog.tsx";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    fetchPendingIssues: vi.fn(),
    ingestIssues: vi.fn(),
  },
}));

// Capture the latest SSE callback registered by the dialog so tests can
// drive `run:created` events directly without spinning up an EventSource.
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

const issueC = {
  id: "issue-c",
  title: "Third issue",
  description: "",
  state: "Todo",
  labels: ["backend", "urgent"],
  priority: 1,
  project: "Platform",
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog issue list interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("renders an issue's project badge and labels, and toggling one checkbox updates the selection count", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [issueA, issueB, issueC],
    });

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueC.title)).toBeDefined());

    // Project badge and labels render for issueC.
    expect(screen.getByText("Platform")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined(); // priority 1 label

    // All three selected by default.
    expect(
      screen.getByRole("button", { name: /start 3 runs/i }),
    ).toBeDefined();

    // Toggle one issue off via its own checkbox.
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // First checkbox is "select all"; find issueA's row checkbox by label text.
    const issueACheckbox = screen
      .getByText(issueA.title)
      .closest("label")
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(issueACheckbox.checked).toBe(true);

    await userEvent.click(issueACheckbox);

    expect(issueACheckbox.checked).toBe(false);
    expect(
      screen.getByRole("button", { name: /start 2 runs/i }),
    ).toBeDefined();

    // The "select all" checkbox should now be unchecked since not all are selected.
    const selectAllCheckbox = checkboxes[0];
    expect(selectAllCheckbox.checked).toBe(false);

    // Re-check it via the same checkbox.
    await userEvent.click(issueACheckbox);
    expect(
      screen.getByRole("button", { name: /start 3 runs/i }),
    ).toBeDefined();
  });

  it("deselects and reselects all issues via the 'select all' checkbox", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(
      screen.getByRole("button", { name: /start 2 runs/i }),
    ).toBeDefined();

    const selectAllCheckbox = screen.getByText(/select all/i)
      .closest("label")
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(selectAllCheckbox.checked).toBe(true);

    await userEvent.click(selectAllCheckbox);

    expect(selectAllCheckbox.checked).toBe(false);
    // With nothing selected, the Start button is disabled (0 selected
    // renders singular "Start 0 Run").
    expect(
      (screen.getByRole("button", { name: /start 0 run/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await userEvent.click(selectAllCheckbox);

    expect(selectAllCheckbox.checked).toBe(true);
    expect(
      screen.getByRole("button", { name: /start 2 runs/i }),
    ).toBeDefined();
  });

  it("shows an error message when fetching pending issues fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
    expect(screen.queryByText(/select all/i)).toBeNull();
  });

  it("shows a generic error message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("network exploded");

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("falls back to the 'None' priority label for an issue with an unrecognized priority", async () => {
    const oddPriorityIssue = { ...issueA, id: "issue-odd", priority: 99 };
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [oddPriorityIssue],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("None")).toBeDefined();
  });
});

describe("LinearSyncDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-closes after SSE delivers run:created for every selected issue (past min loader delay)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();

    // ingestIssues never resolves in this test — auto-close must come from SSE
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

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

    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });
    });
  });

  it("auto-closes when ingestIssues resolves first (SSE never fires)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({
      ok: true,
      started: [issueA.id],
      skipped: [issueB.id],
    });

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

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 1 });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("fires a second onIngestComplete when ingestIssues settles after the min loader delay has already elapsed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    let resolveIngest: ((v: { ok: boolean; started: string[]; skipped: string[] }) => void) | null =
      null;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((resolve) => {
        resolveIngest = resolve;
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

    // Advance well past MIN_LOADER_MS before the HTTP request settles, so
    // that when it does settle, maybeAutoClose closes synchronously in the
    // same tick rather than scheduling a delayed follow-up.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveIngest!({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    // Once from inside maybeAutoClose's synchronous close, and once more
    // from handleIngest's own "final" onIngestComplete call.
    expect(onIngestComplete).toHaveBeenCalledTimes(2);
    expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 1, skipped: 1 });
    expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("stays open and surfaces the error when ingestIssues rejects", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.ingestIssues.mockRejectedValue(new Error("Linear unreachable"));

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

    await waitFor(() => {
      expect(screen.getByText(/Linear unreachable/i)).toBeDefined();
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onIngestComplete).not.toHaveBeenCalled();
    // Start button should be re-enabled (no longer Starting...) so the user
    // can retry.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a pending min-loader-delay timer if the dialog is closed and reopened before it fires", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    // ingestIssues never settles — the only way to schedule the delayed
    // maybeAutoClose is via SSE observing every pending id while still
    // inside the MIN_LOADER_MS window.
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Both issues observed via SSE almost immediately: allSeen is true but
    // elapsed time is still well under MIN_LOADER_MS, so a delayed close is
    // scheduled (minDelayTimerRef gets set) instead of closing immediately.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // Close and reopen the dialog before the scheduled timer fires. On
    // reopen, the effect clears the stale pending timer.
    rerender(
      <LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />,
    );
    rerender(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    // Advance well past the original MIN_LOADER_MS window. If the stale
    // timer had not been cleared, onClose would fire here.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the pending min-loader-delay timer on unmount", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Schedules the delayed maybeAutoClose (elapsed still under MIN_LOADER_MS).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Unmounting before the timer fires must not throw, and must not invoke
    // onClose after the fact.
    expect(() => unmount()).not.toThrow();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("skips scheduling a second delayed close when one is already pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

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

    // First two events observe every pending id and schedule the delayed
    // close (elapsed still under MIN_LOADER_MS).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // A duplicate event for an already-seen id, still inside the delay
    // window, must not schedule a second timer or close early.
    fireSSE({ type: "run:created", runId: "run-a-dup", issueId: issueA.id });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    // Only the single scheduled timer should have fired the close/summary.
    expect(onIngestComplete).toHaveBeenCalledOnce();
  });

  it("ignores a late SSE event that arrives after the dialog has already auto-closed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });

    // A duplicate/late event for an id that is still (stale) in the pending
    // set must be a no-op: maybeAutoClose short-circuits on closedRef.
    fireSSE({ type: "run:created", runId: "run-a-2", issueId: issueA.id });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores SSE events that are not run:created, lack an issueId, or target an unrelated issue", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Wrong event type.
    fireSSE({ type: "run:state-changed", runId: "run-a", issueId: issueA.id });
    // No issueId at all.
    fireSSE({ type: "run:created", runId: "run-x" });
    // issueId not among the pending ones.
    fireSSE({ type: "run:created", runId: "run-z", issueId: "issue-unrelated" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of the above should have advanced the ingest toward auto-close.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onIngested when the ingest response reports zero started runs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onIngested = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({
      ok: true,
      started: [],
      skipped: [issueA.id, issueB.id],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={onIngested} />,
    );

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

  it("shows a generic error message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    mockApi.ingestIssues.mockRejectedValue("boom, no stack");

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("no-ops a stale delayed maybeAutoClose whose pending ids were already cleared by a prior ingest error", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    let rejectIngest: ((err: Error) => void) | null = null;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectIngest = reject;
      }),
    );

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Both ids observed quickly, well under MIN_LOADER_MS, while the ingest
    // request is still in flight (not settled) -> schedules a delayed
    // maybeAutoClose call rather than closing immediately.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // The ingest request now rejects, *before* the scheduled timer fires.
    // The error handler resets pendingIdsRef to [] and does not itself call
    // maybeAutoClose.
    await act(async () => {
      rejectIngest!(new Error("Linear unreachable"));
    });
    await waitFor(() => {
      expect(screen.getByText(/Linear unreachable/i)).toBeDefined();
    });

    // Now let the previously scheduled timer fire. It calls maybeAutoClose
    // again, which must see pendingIdsRef.current as empty and bail out
    // rather than closing the (already-erroring) dialog.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
