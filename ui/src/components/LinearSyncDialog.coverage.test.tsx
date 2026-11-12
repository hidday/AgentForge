import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinearSyncDialog } from "./LinearSyncDialog.tsx";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

// Closes a large coverage gap in LinearSyncDialog.tsx left by
// LinearSyncDialog.test.tsx: the `open=false` guards, toggleAll/toggleOne,
// the handleSSE early-return guards, the min-loader-delay "already
// scheduled" short-circuit, the pending-timer cleanup on reopen/unmount, the
// double onIngestComplete call when the HTTP response settles after an
// SSE-driven close, the started=0 (no onIngested) path, the priority
// fallback, and the project/labels/singular-run-count rendering branches.

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
  labels: ["backend", "urgent-label"],
  priority: 2,
  project: "Core",
};

const issueB = {
  id: "issue-b",
  title: "Second issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 99, // unmapped priority -> exercises the PRIORITY_LABELS fallback
  project: undefined,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog – coverage gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing and does not fetch issues when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("renders issue metadata: unmapped priority falls back to 'None', missing project hides the chip, labels render, and toggling selection works", async () => {
    const user = userEvent.setup();
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // issueA has a project chip and labels.
    expect(screen.getByText("Core")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent-label")).toBeDefined();

    // issueB has an unmapped priority (99) -> falls back to PRIORITY_LABELS[0] ("None").
    const noneLabels = screen.getAllByText("None");
    expect(noneLabels.length).toBeGreaterThan(0);

    // Both selected initially -> "Start 2 Runs".
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Uncheck one issue (toggleOne) -> singular "Start 1 Run" (no trailing "s").
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // checkboxes[0] is "select all"; issue checkboxes follow.
    await user.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();

    // Re-check it (toggleOne back on).
    await user.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // toggleAll: uncheck "select all" clears the selection entirely.
    const selectAllCheckbox = checkboxes[0];
    expect(selectAllCheckbox.checked).toBe(true);
    await user.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(false);

    // Start button disabled once nothing is selected.
    expect(
      (screen.getByRole("button", { name: /^start 0 run$/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // toggleAll again: re-selects everything.
    await user.click(selectAllCheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("ignores SSE events that are not run:created, have no issueId, or reference an issue we aren't waiting on", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {})); // never resolves

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Wrong event type: ignored.
    fireSSE({ type: "run:state-changed", runId: "run-x" });
    // run:created with no issueId: ignored.
    fireSSE({ type: "run:created", runId: "run-x" });
    // run:created for an issue we never selected: ignored.
    fireSSE({ type: "run:created", runId: "run-y", issueId: "some-other-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of the ignored events should have progressed the auto-close.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not re-schedule the min-loader timer if one is already pending (duplicate SSE events)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({ started: [issueA.id, issueB.id], skipped: [] });

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

    // ingestIssues has resolved (settled=true), so maybeAutoClose scheduled a
    // delayed close. Firing another SSE event for a pending issue
    // immediately re-invokes maybeAutoClose while that timer is still
    // pending, exercising the "already scheduled" short-circuit.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("clears a pending min-loader timer when the dialog is closed and reopened before it fires", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({ started: [issueA.id, issueB.id], skipped: [] });

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // ingestIssues has settled; a min-loader timer is now pending.

    // Close (open=false): the effect short-circuits and does NOT clear the
    // pending timer.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);

    // Reopen before the timer would have fired: this re-runs the open
    // effect, which clears the stale pending timer.
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // The stale timer was cleared on reopen, so the earlier ingest cycle
    // never auto-closes the (now-reopened) dialog.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears a pending min-loader timer on unmount", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({ started: [issueA.id, issueB.id], skipped: [] });

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // A min-loader timer is now pending.

    expect(() => unmount()).not.toThrow();

    // Advancing timers after unmount must not throw (timer was cleared) and
    // must not invoke onClose on the unmounted component.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onIngested when the ingest response starts zero runs, but still auto-closes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    const onIngested = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({ started: [], skipped: [issueA.id, issueB.id] });

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={onIngested} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Settling with zero started runs still satisfies the close condition
    // (settled=true), so the dialog reports its close via onClose...
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    // ...but onIngested (which only fires when at least one run started)
    // must not be called.
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("fires onIngestComplete a second time with authoritative counts when the HTTP response settles after SSE already closed the dialog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    let resolveIngest!: (v: { started: string[]; skipped: string[] }) => void;
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

    // Advance the fake clock well past MIN_LOADER_MS *before* the HTTP
    // response settles, so that once it does settle, maybeAutoClose closes
    // the dialog synchronously inside handleIngest's own continuation.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).not.toHaveBeenCalled(); // not settled yet, no SSE either

    await act(async () => {
      resolveIngest({ started: [issueA.id, issueB.id], skipped: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngested).toHaveBeenCalledOnce();
    // Called once by the synchronous maybeAutoClose() in the try block, and
    // again by the authoritative-counts check right after.
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });
    expect(onIngestComplete.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("shows the Error's message when fetchPendingIssues rejects with an Error", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("shows a generic fetch-failure message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("network down");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("shows a generic ingest-failure message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup();
    mockApi.ingestIssues.mockRejectedValue("boom");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("ignores a stray run:created SSE event for an issue that already closed the dialog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({ started: [issueA.id, issueB.id], skipped: [] });

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

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    onIngestComplete.mockClear();

    // A late/duplicate SSE event for one of the already-ingested issues
    // arrives after the dialog has already closed for this cycle.
    fireSSE({ type: "run:created", runId: "run-a-dup", issueId: issueA.id });

    // closedRef is already true, so this must be a complete no-op: no
    // additional close/summary callbacks.
    expect(onClose).toHaveBeenCalledOnce();
    expect(onIngestComplete).not.toHaveBeenCalled();
  });
});
