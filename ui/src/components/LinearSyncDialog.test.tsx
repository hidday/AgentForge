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

  it("renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows an error when the initial issue fetch fails", async () => {
    mockApi.fetchPendingIssues.mockReset();
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Linear API down/i)).toBeDefined();
    });
  });

  it("shows the empty state and hides the Start button when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValueOnce({ issues: [] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/No pending issues found/i)).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("renders an issue's project badge and labels, and falls back to the None priority label for an unmapped priority", async () => {
    mockApi.fetchPendingIssues.mockResolvedValueOnce({
      issues: [
        {
          id: "issue-c",
          title: "Third issue",
          description: "",
          state: "Todo",
          labels: ["backend", "urgent-fix"],
          priority: 99,
          project: "Core Platform",
        },
      ],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Third issue")).toBeDefined());
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
  });

  it("clicking Refresh re-fetches the issue list", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTitle("Refresh"));
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
  });

  it("toggling an individual issue off updates the selection count and unchecks Select all", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // checkboxes[0] is "Select all"; issue checkboxes follow.
    await user.click(checkboxes[1]);

    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();
    expect(checkboxes[0].checked).toBe(false);
  });

  it("toggling an individual issue back on restores it to the selection", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];

    await user.click(checkboxes[1]); // deselect issueA
    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();

    await user.click(checkboxes[1]); // reselect issueA
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
    expect(checkboxes[0].checked).toBe(true);
  });

  it("toggleAll selects and deselects every issue, disabling Start when none are selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const selectAll = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(selectAll.checked).toBe(true);

    await user.click(selectAll);
    const startBtn = screen.getByRole("button", { name: /^start 0 run$/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);

    await user.click(selectAll);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("ignores SSE events that are a different type, missing an issueId, or for an issue that isn't pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:updated", runId: "run-x", issueId: issueA.id } as never);
    fireSSE({ type: "run:created", runId: "run-y" } as never);
    fireSSE({ type: "run:created", runId: "run-z", issueId: "unrelated-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onIngested when the ingest response reports zero started runs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

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
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngested).not.toHaveBeenCalled();
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 2 });
  });

  it("still fires onIngested and a final authoritative onIngestComplete when SSE auto-closes before the HTTP response settles", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    let resolveIngest: ((v: { ok: boolean; started: string[]; skipped: string[] }) => void) | undefined;
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
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    await act(async () => {
      resolveIngest?.({ ok: true, started: [issueA.id, issueB.id], skipped: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onIngested).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
    });
    expect(onIngestComplete).toHaveBeenLastCalledWith({ started: 2, skipped: 0 });
  });

  it("shows a generic error when the initial fetch rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockReset();
    mockApi.fetchPendingIssues.mockRejectedValue("boom");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch issues/i)).toBeDefined();
    });
  });

  it("shows a generic error when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("boom");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to ingest issues/i)).toBeDefined();
    });
  });

  it("clears a pending auto-close timer and re-fetches when the dialog is closed and reopened before it fires", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // Both seen, not settled, still inside MIN_LOADER_MS: a deferred
    // auto-close timer is now scheduled.

    clearTimeoutSpy.mockClear();
    mockApi.fetchPendingIssues.mockClear();

    rerender(<LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalled());
  });

  it("clears a pending auto-close timer on unmount", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    clearTimeoutSpy.mockClear();
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("does not schedule a second auto-close timer for a duplicate SSE event, and still closes exactly once", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // Duplicate event for an issue already seen — maybeAutoClose runs again
    // while a timer is already pending and must not schedule a second one.
    fireSSE({ type: "run:created", runId: "run-a-dup", issueId: issueA.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("bails out of a deferred auto-close if the pending ids were reset by an ingest error before the timer fires", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    let rejectIngest: ((err: Error) => void) | undefined;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((_, reject) => {
        rejectIngest = reject;
      }),
    );

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // Deferred auto-close timer is now scheduled (all seen, not yet
    // settled, still inside MIN_LOADER_MS).

    await act(async () => {
      rejectIngest?.(new Error("Linear unreachable"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/Linear unreachable/i)).toBeDefined());

    // When the deferred timer fires, pendingIdsRef has already been reset to
    // [] by the error handler, so maybeAutoClose must bail out instead of
    // closing the dialog.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
