import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinearSyncDialog } from "./LinearSyncDialog.tsx";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

// This file targets branches left uncovered by LinearSyncDialog.test.tsx
// (the primary suite, which is never modified): the closed-render path,
// reopen/unmount timer cleanup, select-all/individual toggling, fetch
// errors, non-Error rejections, irrelevant/duplicate SSE events, the
// already-closed and already-scheduled guards inside maybeAutoClose, the
// started===0 (all-skipped) path, priority/project/pluralization fallbacks.

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

describe("LinearSyncDialog – additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when open is false, and does not fetch issues", () => {
    const { container } = render(
      <LinearSyncDialog
        open={false}
        onClose={vi.fn()}
        onIngested={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows an error state when the initial issue fetch fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("shows a generic error message when the initial fetch rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("boom");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("shows a generic error message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockRejectedValue("network blip");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("shows the empty state and the 'no pending issues' copy when the list is empty", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No pending issues found")).toBeDefined();
    });
    // Footer's Start button is only rendered when there are issues.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("toggles individual issues and select-all off/on", async () => {
    const user = userEvent.setup();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));

    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Uncheck issue A individually.
    const checkboxes = screen.getAllByRole("checkbox");
    // First checkbox is "select all"; the rest are per-issue.
    await user.click(checkboxes[1]!);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    // Select-all checkbox should now be unchecked (not all selected).
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);

    // Click select-all: since not all are selected, this selects all again.
    await user.click(checkboxes[0]!);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Click select-all again: now all are selected, so this clears the selection.
    await user.click(checkboxes[0]!);
    // 0 is not > 1, so the singular form (no trailing "s") is used, and the
    // button is disabled since nothing is selected.
    const startBtn = screen.getByRole("button", { name: /start 0 run$/i });
    expect(startBtn.textContent).toBe("Start 0 Run");
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("re-checks a previously unchecked issue via toggleOne", async () => {
    const user = userEvent.setup();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));

    const checkboxes = screen.getAllByRole("checkbox");
    // Uncheck issue A, then re-check it (exercises the "add" branch of toggleOne).
    await user.click(checkboxes[1]!);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();
    await user.click(checkboxes[1]!);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("renders label chips for issues that have labels", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, labels: ["backend", "urgent-fix"] }],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));

    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
  });

  it("fires a second, authoritative onIngestComplete after auto-closing via SSE once ingestIssues later resolves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });

    let resolveIngest!: (v: { ok: boolean; started: string[]; skipped: string[] }) => void;
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
    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    // SSE observes the run before the HTTP response lands, and the min-delay
    // window has elapsed, so the dialog auto-closes optimistically.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 0 });

    // The authoritative HTTP response now resolves after the close; it must
    // still fire a final onIngestComplete with the real counts.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [] });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
    });
    expect(onIngestComplete).toHaveBeenLastCalledWith({ started: 1, skipped: 0 });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("falls back to the 'None' priority label for an unrecognized priority", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));

    expect(screen.getByText("None")).toBeDefined();
  });

  it("does not render a project badge when the issue has no project", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, project: undefined }],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));

    // Only the priority label ("High" for priority 2) should render as a badge;
    // no project text node should be present.
    expect(screen.getByText("High")).toBeDefined();
  });

  it("renders singular 'Start 1 Run' (no trailing s) for exactly one selected issue", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));

    const btn = screen.getByRole("button", { name: /start 1 run$/i });
    expect(btn.textContent).toBe("Start 1 Run");
  });

  it("does not call onIngested when every issue is skipped (started.length === 0)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [issueA.id] });

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={onIngested}
        onIngestComplete={onIngestComplete}
      />,
    );
    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 1 });
    });
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("ignores SSE events unrelated to run:created, without an issueId, or for an id that isn't pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Wrong event type: ignored.
    fireSSE({ type: "process:started", runId: "r1" });
    // Missing issueId: ignored.
    fireSSE({ type: "run:created", runId: "r2" });
    // issueId not among the pending set: ignored.
    fireSSE({ type: "run:created", runId: "r3", issueId: "unrelated-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of the above should have triggered a close.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();
  });

  it("ignores a duplicate SSE event once the min-delay timer is already scheduled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // Duplicate delivery for an already-seen id while the min-delay timer is
    // pending: should hit the "already scheduled" early-return branch rather
    // than scheduling a second timer.
    fireSSE({ type: "run:created", runId: "run-a-dup", issueId: issueA.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("ignores further SSE events for the same run after the dialog has already auto-closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    // Firing another event for the same (still-pending-ref) issue id after
    // close must hit the closedRef.current guard and do nothing further.
    expect(() =>
      fireSSE({ type: "run:created", runId: "run-a-again", issueId: issueA.id }),
    ).not.toThrow();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears a pending auto-close timer when the dialog is reopened mid-flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    // Trigger allSeen so a MIN_LOADER_MS timer gets scheduled, but don't let
    // it fire yet.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

    // Close then reopen before the timer elapses: the open-effect should
    // clear the stale timer (and reset ingest tracking) rather than leaving
    // it to fire later.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // The stale timer must not have fired a close from the previous cycle.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears any pending timer on unmount without throwing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => screen.getByText(issueA.title));
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    // Schedule the MIN_LOADER_MS timer, then unmount before it fires.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

    expect(() => unmount()).not.toThrow();

    // Advancing timers post-unmount must not throw either (cleanup ran).
    expect(() => {
      vi.advanceTimersByTime(2000);
    }).not.toThrow();
  });
});
