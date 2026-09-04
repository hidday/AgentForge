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
  labels: ["bug", "urgent-fix"],
  priority: 2,
  project: "Core Platform",
};

const issueB = {
  id: "issue-b",
  title: "Second issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 99, // unknown priority — should fall back to the "None" label
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog — additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("falls back to a generic error message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("network unreachable");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("surfaces the Error instance's message when fetchPendingIssues rejects with a real Error", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API key missing"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Linear API key missing")).toBeDefined();
    });
  });

  it("clears a pending min-loader timer when the dialog is closed and reopened before it fires", async () => {
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Both issues seen almost immediately — schedules the MIN_LOADER_MS
    // delayed close instead of closing right away.
    fireSSE({ type: "run:created", runId: "r1", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "r2", issueId: issueB.id });

    const callsBeforeReopen = clearTimeoutSpy.mock.calls.length;

    // Close and reopen the dialog before the scheduled timer fires. The
    // open-effect must clear the stale timer instead of leaking it.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBeforeReopen);

    // Advancing time past the original delay must not trigger a stale close
    // for the old (now-reset) ingest cycle.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("clears a pending min-loader timer on unmount so it cannot fire after the component is gone", async () => {
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "r1", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "r2", issueId: issueB.id });

    const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;

    unmount();

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);

    // Advancing timers post-unmount must not throw (e.g. from setState on an
    // unmounted component) because the pending timer was cleared.
    expect(() => {
      vi.advanceTimersByTime(1000);
    }).not.toThrow();

    clearTimeoutSpy.mockRestore();
  });

  it("renders the project badge and issue labels, and falls back to the None priority label for an unrecognised priority", async () => {
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // Project badge (only issueA has a project).
    expect(screen.getByText("Core Platform")).toBeDefined();

    // Labels for issueA.
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();

    // issueB has an unrecognised priority (99) and no project — falls back to "None".
    expect(screen.getByText("None")).toBeDefined();
  });

  it("toggleAll deselects then reselects all issues, updating the Start button count", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // All selected by default.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    await user.click(selectAllCheckbox);

    // Deselected — Start button should be disabled with 0 selected (singular
    // wording: 0 is not > 1, so no trailing "s").
    const startBtn = screen.getByRole("button", { name: /^start 0 run$/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);

    await user.click(selectAllCheckbox);

    // Reselected all.
    expect(
      (screen.getByRole("button", { name: /start 2 runs/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("toggleOne deselects and reselects a single issue, using singular wording for one run", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueACheckbox = screen.getByRole("checkbox", { name: new RegExp(issueA.title) });
    await user.click(issueACheckbox);

    // Only issueB remains selected — singular "Run" wording.
    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();

    await user.click(issueACheckbox);

    // Both selected again — plural wording.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("ignores SSE events that are not run:created, lack an issueId, or reference an issue that is not pending", async () => {
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Wrong event type — ignored.
    fireSSE({ type: "run:state-changed", runId: "r1" });
    // run:created with no issueId — ignored.
    fireSSE({ type: "run:created", runId: "r2" });
    // run:created for an issue that was never part of this ingest batch — ignored.
    fireSSE({ type: "run:created", runId: "r3", issueId: "not-pending-id" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of the above should have progressed the auto-close.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();
  });

  it("ignores a duplicate run:created event received after the dialog has already auto-closed", async () => {
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

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "r1", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "r2", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledOnce();

    // A late duplicate event for an already-seen issue fires maybeAutoClose
    // again; closedRef is already true so it must be a no-op.
    fireSSE({ type: "run:created", runId: "r3", issueId: issueA.id });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onIngestComplete).toHaveBeenCalledOnce();
  });

  it("does not schedule a second min-loader timer for redundant events during the delay window", async () => {
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Both issues seen well within MIN_LOADER_MS — schedules the delayed close.
    fireSSE({ type: "run:created", runId: "r1", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "r2", issueId: issueB.id });

    // A redundant duplicate event arrives while the delay timer is already
    // pending — must not schedule a second timer / double-close.
    fireSSE({ type: "run:created", runId: "r3", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("falls back to a generic error message when ingestIssues rejects with a non-Error value", async () => {
    mockApi.ingestIssues.mockRejectedValue("service unavailable");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("does not call onIngested when ingestIssues resolves with zero started runs (all skipped)", async () => {
    const onIngested = vi.fn();
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [issueA.id, issueB.id] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={onIngested} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      // The dialog still auto-closes (settled + all "seen" via the resolved
      // response's own accounting), but onIngested must not fire since
      // nothing was actually started.
      expect(mockApi.ingestIssues).toHaveBeenCalledOnce();
    });
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("calls onIngestComplete a second time with authoritative counts once ingestIssues resolves after an SSE-driven close", async () => {
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

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE observes both issues and, once MIN_LOADER_MS has elapsed, closes
    // the dialog using the *synthesized* summary (ingestIssues hasn't
    // resolved yet).
    fireSSE({ type: "run:created", runId: "r1", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "r2", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });

    // Now the HTTP response finally lands with the authoritative counts —
    // handleIngest resumes past the await and, since closedRef is already
    // true, fires a second onIngestComplete with the real started/skipped.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
    });
    expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    expect(onIngested).toHaveBeenCalledOnce();
    // onClose must not have been invoked a second time.
    expect(onClose).toHaveBeenCalledOnce();
  });
});
