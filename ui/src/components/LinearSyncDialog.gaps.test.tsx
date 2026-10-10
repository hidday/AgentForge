import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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

const issueWithProjectAndLabels = {
  id: "issue-full",
  title: "Full featured issue",
  description: "",
  state: "Todo",
  labels: ["bug", "api"],
  priority: 1,
  project: "Backend Platform",
};

const issueUnknownPriority = {
  id: "issue-unknown-prio",
  title: "Unknown priority issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 99,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog (gaps)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders null when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a loading spinner while fetching issues", async () => {
    mockApi.fetchPendingIssues.mockReturnValue(new Promise(() => {}));
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    expect(screen.getByText(/Fetching issues from Linear/i)).toBeDefined();
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/No pending issues found/i)).toBeDefined();
    });
    // The footer's Start button is only rendered when issues.length > 0.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("shows the error state when fetchPendingIssues rejects", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Linear API down/i)).toBeDefined();
    });
  });

  it("falls back to a generic error message when a non-Error is thrown from fetchPendingIssues", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("not an Error instance");
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch issues/i)).toBeDefined();
    });
  });

  it("renders project badge, labels, and priority label/class for an issue that has them", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Full featured issue")).toBeDefined();
    });

    expect(screen.getByText("Backend Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
  });

  it("falls back to the priority-0 label/class for an unrecognized priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueUnknownPriority] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Unknown priority issue")).toBeDefined();
    });
    expect(screen.getByText("None")).toBeDefined();
  });

  it("does not render a project badge when the issue has no project", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueUnknownPriority] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Unknown priority issue")).toBeDefined();
    });
    // issueUnknownPriority has no `project` field.
    expect(screen.queryByText("Backend Platform")).toBeNull();
  });

  it("toggleAll deselects all when everything is selected, then reselects all", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [issueWithProjectAndLabels, issueUnknownPriority],
    });
    const user = userEvent.setup();
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Select all/i)).toBeDefined());

    // All selected by default.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAllCheckbox = screen.getByLabelText(/Select all/i);
    await user.click(selectAllCheckbox);

    // Everything deselected -> Start button disabled (selected.size === 0).
    const startBtn = screen.getByRole("button", { name: /start 0 run\b/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);

    await user.click(selectAllCheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggleOne deselects a single issue, changing the Start button's singular/plural label and count", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [issueWithProjectAndLabels, issueUnknownPriority],
    });
    const user = userEvent.setup();
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );

    const checkboxes = screen.getAllByRole("checkbox");
    // checkboxes[0] is "select all"; the issue checkboxes follow.
    await user.click(checkboxes[1]);

    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();
  });

  it("toggleOne re-selects an issue that was previously deselected (the Set.add branch)", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [issueWithProjectAndLabels, issueUnknownPriority],
    });
    const user = userEvent.setup();
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]); // deselect -> 1 remaining
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    await user.click(checkboxes[1]); // re-select -> back to 2
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a pending min-loader-delay timer when the dialog is closed and reopened mid-flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueWithProjectAndLabels.id], skipped: [] });

    const onClose = vi.fn();
    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    // ingestIssues resolves almost immediately (well under MIN_LOADER_MS),
    // so maybeAutoClose schedules a follow-up timer via setTimeout rather
    // than closing right away.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Close and reopen before that scheduled timer fires -- the effect that
    // resets state on `open` should clear the pending timer.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // onClose should not have fired from the stale, now-cleared timer.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking the refresh button re-fetches issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    const user = userEvent.setup();
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));
  });

  it("clicking Cancel calls onClose", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/No pending issues found/i)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the backdrop calls onClose", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(/No pending issues found/i)).toBeDefined());
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking Start with nothing selected is a no-op (handleIngest's selected.size === 0 guard)", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    const user = userEvent.setup();
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]); // deselect the only issue

    const startBtn = screen.getByRole("button", { name: /start 0 run\b/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
    // Button is disabled, so clicking is inert either way; verify ingestIssues
    // is never called.
    await user.click(startBtn);
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("fires onIngestComplete a second time with authoritative counts when the HTTP response resolves after SSE already closed the dialog", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [issueWithProjectAndLabels, issueUnknownPriority],
    });

    let resolveIngest!: (value: { ok: boolean; started: string[]; skipped: string[] }) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((resolve) => {
        resolveIngest = resolve;
      }),
    );

    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={onIngested}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Both issues observed via SSE before the HTTP response lands.
    fireSSE({ type: "run:created", runId: "r1", issueId: issueWithProjectAndLabels.id });
    fireSSE({ type: "run:created", runId: "r2", issueId: issueUnknownPriority.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // Now the authoritative HTTP response lands, with different counts.
    await act(async () => {
      resolveIngest({
        ok: true,
        started: [issueWithProjectAndLabels.id],
        skipped: [issueUnknownPriority.id],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
      expect(onIngestComplete).toHaveBeenLastCalledWith({ started: 1, skipped: 1 });
    });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("does not reschedule the min-delay timer when maybeAutoClose is re-triggered while one is already pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    // Firing the same run:created event twice in quick succession (e.g. a
    // duplicate SSE delivery) triggers maybeAutoClose twice while still
    // inside the MIN_LOADER_MS window; the second call must see the timer
    // already scheduled and bail out rather than scheduling a second one.
    fireSSE({ type: "run:created", runId: "r1", issueId: issueWithProjectAndLabels.id });
    fireSSE({ type: "run:created", runId: "r1", issueId: issueWithProjectAndLabels.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("does not call onIngested when the ingest response reports zero started runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    mockApi.ingestIssues.mockResolvedValue({
      ok: true,
      started: [],
      skipped: [issueWithProjectAndLabels.id],
    });

    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={onIngested}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 1 });
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("harmlessly no-ops a scheduled min-delay timer that fires after an ingest error already reset the pending tracker", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });

    let rejectIngest!: (err: Error) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectIngest = reject;
      }),
    );

    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    // SSE reports the run as created while the HTTP request is still in
    // flight -- this schedules a min-delay timer (elapsed < MIN_LOADER_MS).
    fireSSE({ type: "run:created", runId: "r1", issueId: issueWithProjectAndLabels.id });

    // Now the HTTP request fails. The catch branch resets pendingIdsRef to
    // [] but does not cancel the already-scheduled timer.
    await act(async () => {
      rejectIngest(new Error("Linear unreachable"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/Linear unreachable/i)).toBeDefined());

    // When the stale timer eventually fires, maybeAutoClose must see
    // pendingIds is now empty and bail out rather than closing the dialog.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears a pending min-delay timer on unmount without throwing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    // Schedules a min-delay timer (allSeen via SSE, elapsed < MIN_LOADER_MS).
    fireSSE({ type: "run:created", runId: "r1", issueId: issueWithProjectAndLabels.id });

    expect(() => unmount()).not.toThrow();
  });

  it("falls back to a generic error message when a non-Error is thrown from ingestIssues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    mockApi.ingestIssues.mockRejectedValue("not an Error instance");
    const user = userEvent.setup();

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to ingest issues/i)).toBeDefined();
    });
  });

  it("handleIngest's own selected.size===0 guard is a no-op even if the (normally-disabled) Start button is force-clicked", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    const user = userEvent.setup();

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]); // deselect the only issue

    const startBtn = screen.getByRole("button", { name: /start 0 run\b/i }) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);

    // A real browser never dispatches a click handler for a disabled button,
    // and neither does jsdom -- this directly exercises (or confirms the
    // unreachability of) handleIngest's own internal `selected.size === 0`
    // early-return guard, which is otherwise unreachable through the UI
    // since the button is disabled in exactly that condition.
    fireEvent.click(startBtn);
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("ignores SSE events that are not run:created, have no issueId, or reference an issue that isn't pending", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );

    // No ingest has started, so pendingIdsRef is empty; none of these should throw.
    fireSSE({ type: "run:state-changed", runId: "x", from: "a", to: "b" });
    fireSSE({ type: "run:created", runId: "x", issueId: undefined });
    fireSSE({ type: "run:created", runId: "x", issueId: "some-other-issue" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets ingest tracking state when the dialog is closed and reopened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithProjectAndLabels] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndLabels.title)).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));
    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();

    // Close, then reopen -- ingesting state should reset to false.
    rerender(<LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();
    });
  });
});
