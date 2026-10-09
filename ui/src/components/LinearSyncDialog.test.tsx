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

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

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

  it("renders nothing and fetches no issues when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("toggles individual and select-all checkboxes, updating the selection count and button wording", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const getCheckboxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];
    // [0] = select-all, [1] = issueA, [2] = issueB — both start selected.
    expect(getCheckboxes()[0].checked).toBe(true);
    expect(getCheckboxes()[1].checked).toBe(true);
    expect(getCheckboxes()[2].checked).toBe(true);

    // Deselect a single issue — select-all should reflect the partial selection,
    // and the button wording should switch to the singular "Run".
    await user.click(getCheckboxes()[1]);
    expect(getCheckboxes()[1].checked).toBe(false);
    expect(getCheckboxes()[0].checked).toBe(false);
    expect(screen.getByRole("button", { name: "Start 1 Run" })).toBeDefined();

    // Re-check that same issue individually (not via select-all) — exercises
    // toggleOne's "add" branch, as distinct from its "delete" branch above.
    await user.click(getCheckboxes()[1]);
    expect(getCheckboxes()[1].checked).toBe(true);
    expect(getCheckboxes()[0].checked).toBe(true);
    expect(screen.getByRole("button", { name: "Start 2 Runs" })).toBeDefined();

    // Deselect it again, then re-select everything via "select all".
    await user.click(getCheckboxes()[1]);
    await user.click(getCheckboxes()[0]);
    expect(getCheckboxes()[0].checked).toBe(true);
    expect(getCheckboxes()[1].checked).toBe(true);
    expect(screen.getByRole("button", { name: "Start 2 Runs" })).toBeDefined();

    // Deselect everything via "select all" — the Start button becomes disabled.
    await user.click(getCheckboxes()[0]);
    expect(getCheckboxes()[0].checked).toBe(false);
    expect(getCheckboxes()[1].checked).toBe(false);
    expect(getCheckboxes()[2].checked).toBe(false);
    const startBtn = screen.getByRole("button", { name: "Start 0 Run" }) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
  });

  it("shows an error message when fetching issues fails, and recovers on retry via the refresh button", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockRejectedValueOnce(new Error("Linear API unreachable"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Linear API unreachable/i)).toBeDefined();
    });
    expect(screen.queryByText(issueA.title)).toBeNull();

    // Retry via the refresh button — falls back to the default resolved mock.
    await user.click(screen.getByTitle("Refresh"));

    await waitFor(() => {
      expect(screen.getByText(issueA.title)).toBeDefined();
    });
  });

  it("falls back to a generic error message when fetching issues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValueOnce("linear outage");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch issues/i)).toBeDefined();
    });
  });

  it("falls back to the 'None' priority label and renders project + label chips when present", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-c",
          title: "Third issue",
          description: "",
          state: "Todo",
          labels: ["bug", "urgent-fix"],
          priority: 99, // not present in PRIORITY_LABELS
          project: "Core Platform",
        },
      ],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Third issue")).toBeDefined());

    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
  });

  it("ignores SSE events that are not run:created, lack an issueId, or reference an unselected issue", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    // Wrong event type — ignored.
    fireSSE({ type: "run:state-changed", runId: "run-a", issueId: issueA.id });
    // run:created but no issueId — ignored.
    fireSSE({ type: "run:created", runId: "run-x" });
    // run:created for an issue that isn't part of this ingest — ignored.
    fireSSE({ type: "run:created", runId: "run-y", issueId: "unrelated-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a duplicate SSE event for an issue after the dialog has already auto-closed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    // A late, duplicate event for an issue we've already closed for must be a no-op.
    fireSSE({ type: "run:created", runId: "run-a-retry", issueId: issueA.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not double-schedule the min-loader delay when maybeAutoClose is re-invoked before it elapses", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // All ids are now seen but we're still inside MIN_LOADER_MS, so a timer
    // was scheduled. A duplicate event for an already-seen id re-invokes
    // maybeAutoClose and must hit the "already scheduled" guard rather than
    // scheduling a second timer.
    fireSSE({ type: "run:created", runId: "run-a-dup", issueId: issueA.id });

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("fires a second, authoritative onIngestComplete when the HTTP response lands after the SSE-triggered auto-close", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();
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
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    // SSE observes both issues before the HTTP response lands — auto-close
    // fires optimistically with a synthesized summary.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });
    });

    // The HTTP response now lands with different, authoritative counts.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    });
    expect(onIngested).toHaveBeenCalledOnce();
    // The already-closed dialog must not be closed a second time.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a generic error message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("linear 500");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to ingest issues/i)).toBeDefined();
    });
  });

  it("does not call onIngested when ingestIssues resolves with nothing started (all skipped)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onIngested = vi.fn();
    const onClose = vi.fn();
    mockApi.ingestIssues.mockResolvedValue({
      ok: true,
      started: [],
      skipped: [issueA.id, issueB.id],
    });

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={onIngested}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("clears a leftover min-loader timer when the dialog is reopened mid-cycle", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // A min-loader timer is now pending (allSeen but still inside MIN_LOADER_MS).

    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // The stale timer was cleared on reopen, so advancing past its original
    // delay must not trigger a close for the new (unstarted) cycle.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the pending min-loader timer on unmount without throwing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // Both ids are seen but we're still inside MIN_LOADER_MS — a timer is pending.

    expect(() => unmount()).not.toThrow();

    // Advancing timers after unmount must not throw (the timer was cleared
    // by the unmount cleanup effect).
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
  });

  it("ignores a stale ingestIssues resolution for a cycle superseded by reopening the dialog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();
    let resolveIngest!: (v: { ok: boolean; started: string[]; skipped: string[] }) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((res) => {
        resolveIngest = res;
      }),
    );

    const { rerender } = render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Start 2 Runs" }));

    // Close and reopen the dialog while the ingest HTTP request is still in
    // flight — this resets pendingIdsRef/closedRef for a fresh cycle.
    rerender(
      <LinearSyncDialog
        open={false}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );
    rerender(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // The original request now resolves — it belongs to a superseded cycle,
    // so it must not close the freshly-reopened dialog nor emit a summary.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [] });
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onIngestComplete).not.toHaveBeenCalled();
  });
});
