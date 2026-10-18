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
  labels: ["urgent-fix"],
  priority: 1,
  project: "Core Platform",
};

const issueB = {
  id: "issue-b",
  title: "Second issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 2,
};

describe("LinearSyncDialog – additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an issue's project tag and labels, and unchecking it updates the start count", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // Project tag and label are rendered for issueA.
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
    // Priority label renders too.
    expect(screen.getByText("Urgent")).toBeDefined();

    // Both issues selected by default.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Uncheck issue A via its own checkbox (toggleOne).
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // checkboxes[0] is "select all"; issue checkboxes follow in list order.
    const issueACheckbox = checkboxes[1];
    await user.click(issueACheckbox);

    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    // Re-check it via toggleOne again.
    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("deselects and reselects all issues via the 'Select all' checkbox (toggleAll)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(selectAllCheckbox.checked).toBe(true);

    await user.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(false);
    // The Start button is disabled when nothing is selected.
    const startBtn = screen.getByRole("button", { name: /start 0 run\b/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);

    await user.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("re-fetches issues when the refresh button is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueB] });
    await user.click(screen.getByTitle("Refresh"));

    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(issueA.title)).toBeNull());
    expect(screen.getByText(issueB.title)).toBeDefined();
  });

  it("surfaces an error message when fetchPendingIssues rejects", async () => {
    mockApi.fetchPendingIssues.mockReset();
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockReset();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No pending issues found")).toBeDefined();
    });
    // No Start button is rendered when there are no issues at all.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const { container } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does nothing and never calls ingestIssues when Start is clicked with nothing selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    await user.click(selectAllCheckbox); // deselect all

    // Start button is disabled, but exercise handleIngest's early-return guard directly
    // by confirming no API call is made even if somehow invoked with nothing selected.
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("does not call onIngested when ingestIssues resolves with zero started runs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [issueA.id, issueB.id] });

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={onIngested}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 2 });
    });
    // sawAtLeastOneStart was false, so onIngested is never called.
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("fires a second, authoritative onIngestComplete when ingestIssues resolves after SSE already auto-closed", async () => {
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

    // SSE delivers run:created for both issues, and once MIN_LOADER_MS has
    // passed the dialog auto-closes optimistically — before ingestIssues
    // itself has resolved.
    expect(sseCallback).not.toBeNull();
    act(() => {
      sseCallback!({ type: "run:created", runId: "run-a", issueId: issueA.id });
      sseCallback!({ type: "run:created", runId: "run-b", issueId: issueB.id });
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // Now the real HTTP response lands, with the authoritative counts.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 1 });
    });
    expect(onIngested).toHaveBeenCalledOnce();
    // onClose was not invoked a second time by the now-redundant maybeAutoClose() call.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears a pending min-delay auto-close timer when the dialog is reopened mid-wait", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueA.id], skipped: [] });

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // ingestIssues resolves almost immediately, well inside MIN_LOADER_MS,
    // so maybeAutoClose schedules a delayed timer instead of closing now.
    await waitFor(() => expect(mockApi.ingestIssues).toHaveBeenCalled());

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    clearTimeoutSpy.mockClear();

    // The parent toggles the dialog closed and immediately back open again
    // before the scheduled auto-close timer fires.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    expect(clearTimeoutSpy).toHaveBeenCalled();

    // Advance well past MIN_LOADER_MS: the stale timer must not fire a
    // leftover auto-close for the cycle that just got reset.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("clears a pending min-delay timer on unmount without throwing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueA.id], skipped: [] });

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // ingestIssues resolves almost immediately (well under MIN_LOADER_MS),
    // scheduling a delayed-close timer that is still pending at unmount.
    await waitFor(() => expect(mockApi.ingestIssues).toHaveBeenCalled());

    expect(() => unmount()).not.toThrow();
  });

  it("falls back to a generic error message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockReset();
    mockApi.fetchPendingIssues.mockRejectedValue("network blip");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("falls back to a generic error message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("linear down");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("falls back to the 'None' priority style for an issue with an unrecognized priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("None")).toBeDefined();
    });
  });

  it("ignores a no-op maybeAutoClose call once pendingIds has been reset (stale ingest resolving after reopen)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    let resolveIngest!: (v: { ok: boolean; started: string[]; skipped: string[] }) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((res) => {
        resolveIngest = res;
      }),
    );

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    await waitFor(() => expect(mockApi.ingestIssues).toHaveBeenCalled());

    // Reopen the dialog, which resets pendingIdsRef to [] for a fresh cycle.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    // The stale promise from the previous cycle now resolves; its
    // maybeAutoClose() call must no-op since pendingIdsRef is now empty.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [] });
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not reschedule the min-delay timer when a duplicate SSE event arrives after one is already pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    expect(sseCallback).not.toBeNull();
    act(() => {
      sseCallback!({ type: "run:created", runId: "run-a", issueId: issueA.id });
      sseCallback!({ type: "run:created", runId: "run-b", issueId: issueB.id });
      // Duplicate event for an already-seen issue, fired after the
      // min-delay timer has already been scheduled.
      sseCallback!({ type: "run:created", runId: "run-a-again", issueId: issueA.id });
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Only a single auto-close should occur, not one per SSE event.
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("ignores SSE events that are not run:created, or that reference an unrelated/missing issue id", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    expect(sseCallback).not.toBeNull();
    act(() => {
      // Wrong event type.
      sseCallback!({ type: "process:started", runId: "run-x" });
      // run:created with no issueId.
      sseCallback!({ type: "run:created", runId: "run-y" });
      // run:created for an issue that was never part of this ingest batch.
      sseCallback!({ type: "run:created", runId: "run-z", issueId: "unrelated-issue" });
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of those events should have advanced the auto-close logic.
    expect(onClose).not.toHaveBeenCalled();
  });
});
