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

  it("shows a loading indicator while fetching issues", () => {
    mockApi.fetchPendingIssues.mockReturnValue(new Promise(() => {}));
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(screen.getByText(/Fetching issues from Linear/i)).toBeDefined();
  });

  it("shows an error state when fetching issues fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("boom"));
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("boom")).toBeDefined();
    });
  });

  it("shows an empty state and hides the Start button when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("No pending issues found")).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("renders issue metadata: short id, project badge, priority label, and tags", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-c-12345678",
          title: "Third issue",
          description: "",
          state: "Todo",
          labels: ["bug", "urgent-fix"],
          priority: 1,
          project: "Core Platform",
        },
      ],
    });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("Third issue")).toBeDefined());

    expect(screen.getByText("issue-c-")).toBeDefined();
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
  });

  it("toggling one issue off then back on updates the Start button count", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const checkboxA = screen.getAllByRole("checkbox")[1]!; // index 0 is "select all"
    await user.click(checkboxA);
    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();

    await user.click(checkboxA);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggleAll deselects everything, then reselects everything", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAll = screen.getAllByRole("checkbox")[0]! as HTMLInputElement;
    expect(selectAll.checked).toBe(true);

    await user.click(selectAll);
    expect(selectAll.checked).toBe(false);
    expect(screen.getByText("Select all (2)")).toBeDefined();
    // Start button disabled with nothing selected.
    expect(screen.getByRole("button", { name: /start 0 run/i })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(selectAll);
    expect(selectAll.checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("Cancel button calls onClose", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("returns null and renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("clears a pending min-delay timer when the dialog closes and reopens mid-ingest", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // SSE resolves immediately, well inside the MIN_LOADER_MS window, so a
    // delayed-close timer gets scheduled.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // Parent closes and reopens the dialog before that timer fires.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // The stale timer from the previous cycle was cleared on reopen, so it
    // never fires the earlier close.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires a second onIngestComplete with authoritative counts after SSE already closed the dialog", async () => {
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

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // The HTTP response lands afterward with the authoritative counts.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 1 });
    });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("shows a generic error when fetching issues fails with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("network down");
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("shows a generic error when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("some string rejection");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("does not call onIngested when the ingest response starts zero runs", async () => {
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

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onIngested).not.toHaveBeenCalled();
  });

  it("falls back to the 'None' priority style for an unrecognized priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-weird",
          title: "Weird priority issue",
          description: "",
          state: "Todo",
          labels: [],
          priority: 99,
        },
      ],
    });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Weird priority issue")).toBeDefined());
    expect(screen.getByText("None")).toBeDefined();
  });

  it("ignores SSE events that aren't run:created, lack an issueId, or aren't pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Wrong event type: ignored entirely.
    fireSSE({ type: "run:state-changed", runId: "run-x" });
    // run:created with no issueId: ignored.
    fireSSE({ type: "run:created", runId: "run-y" });
    // run:created for an issue that isn't part of this ingest cycle: ignored.
    fireSSE({ type: "run:created", runId: "run-z", issueId: "unrelated-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of those events should have progressed the ingest toward closing.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not reschedule the min-delay timer if one is already pending for this cycle", async () => {
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

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // Duplicate delivery of the same event while still inside the
    // MIN_LOADER_MS window: a timer is already scheduled, so this should be
    // a no-op rather than scheduling a second one.
    fireSSE({ type: "run:created", runId: "run-b-dup", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });
    });
  });

  it("clears the pending min-delay timer on unmount without closing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    expect(() => unmount()).not.toThrow();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a stale delayed-close check from a now-reset cycle is a safe no-op", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();
    let rejectIngest!: (err: unknown) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectIngest = reject;
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

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE confirms both issues very quickly, scheduling a delayed close
    // inside the MIN_LOADER_MS window.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Before that timer fires, the underlying HTTP request fails. The
    // error handler resets pendingIdsRef to [] but can't cancel the timer
    // that was already scheduled from the SSE path.
    await act(async () => {
      rejectIngest(new Error("Linear unreachable"));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/Linear unreachable/i)).toBeDefined());

    // When the stale timer fires, maybeAutoClose sees an empty pending set
    // and must bail out instead of closing the dialog with a bogus summary.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onIngestComplete).not.toHaveBeenCalled();
  });

  it("refresh button re-fetches issues", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));
  });
});
