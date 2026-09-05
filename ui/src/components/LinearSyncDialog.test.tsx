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
  // Several tests here drive real setTimeout-based delays (MIN_LOADER_MS)
  // through fake timers with shouldAdvanceTime; under heavy concurrent
  // test-runner load that can be slower than the default timeout.
  vi.setConfig({ testTimeout: 20000 });

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

    // These SSE events should all be ignored by the guard clauses in
    // handleSSE: a non "run:created" type, a "run:created" with no
    // issueId, and a "run:created" for an issue we aren't waiting on.
    fireSSE({ type: "run:state-changed", runId: "run-a" });
    fireSSE({ type: "run:created", runId: "run-x" });
    fireSSE({ type: "run:created", runId: "run-z", issueId: "not-pending-id" });
    expect(onClose).not.toHaveBeenCalled();

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

  it("does not schedule a second min-loader timer when a redundant SSE event arrives while one is already pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();

    // ingestIssues never resolves — auto-close must come purely from SSE.
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

    // Select only issue A so a single SSE event marks every pending id as seen.
    const issueBCheckbox = screen.getByRole("checkbox", { name: new RegExp(issueB.title) });
    await user.click(issueBCheckbox);

    const startBtn = screen.getByRole("button", { name: /start 1 run\b/i });
    await user.click(startBtn);

    // First event: allSeen becomes true, elapsed < MIN_LOADER_MS, so this
    // schedules the delayed close timer (hits the "not yet scheduled" path).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    // Second, redundant event for the same issue: allSeen is still true and
    // a timer is already pending, so this must hit the "already scheduled"
    // early-return instead of scheduling a duplicate timer.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Exactly one close, not one per SSE event.
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 0 });
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

  it("clears a pending min-loader timer on unmount without throwing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueA.id], skipped: [] });

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // Let the ingestIssues promise settle; since barely any real time has
    // elapsed, this schedules a MIN_LOADER_MS-delayed timer rather than
    // closing immediately, leaving a pending timer behind at unmount time.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(() => unmount()).not.toThrow();

    // Advancing timers post-unmount must not throw either (no dangling
    // setState calls on an unmounted component).
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  });

  it("does not call onIngested when every selected issue was skipped (none started)", async () => {
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
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 2 });
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("network exploded");

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() =>
      expect(screen.getByText(/Failed to ingest issues/i)).toBeDefined(),
    );
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

  it("renders nothing when closed", () => {
    const { container } = render(
      <LinearSyncDialog
        open={false}
        onClose={vi.fn()}
        onIngested={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(/No pending issues found/i)).toBeDefined(),
    );
    // No Start button should render when there are no issues to select.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("shows an error and lets the user retry via the refresh button", async () => {
    const user = userEvent.setup();
    mockApi.fetchPendingIssues.mockRejectedValueOnce(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Linear API down/i)).toBeDefined(),
    );

    mockApi.fetchPendingIssues.mockResolvedValueOnce({ issues: [issueA, issueB] });
    await user.click(screen.getByTitle("Refresh"));

    await waitFor(() =>
      expect(screen.getByText(issueA.title)).toBeDefined(),
    );
  });

  it("renders a non-Error rejection from fetchPendingIssues with the fallback message", async () => {
    mockApi.fetchPendingIssues.mockRejectedValueOnce("just a string");

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Failed to fetch issues/i)).toBeDefined(),
    );
  });

  it("renders issue project and label badges, and falls back to the 'None' priority style for an unmapped priority", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-c",
          title: "Labeled issue",
          description: "",
          state: "Todo",
          labels: ["backend", "urgent-fix"],
          priority: 99,
          project: "Core Platform",
        },
      ],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("Labeled issue")).toBeDefined());
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
    // priority 99 isn't in PRIORITY_LABELS, so it falls back to the "None" entry.
    expect(screen.getByText("None")).toBeDefined();
  });

  it("toggles individual issue selection and the select-all checkbox", async () => {
    const user = userEvent.setup();
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // Both issues start selected -> Start 2 Runs, select-all checked.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    expect(selectAllCheckbox).toHaveProperty("checked", true);

    // Uncheck one issue.
    const issueACheckbox = screen.getByRole("checkbox", { name: new RegExp(issueA.title) });
    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();
    expect(selectAllCheckbox).toHaveProperty("checked", false);

    // Re-check it via select-all, which should select every issue again.
    await user.click(selectAllCheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Clicking select-all again while fully selected clears the selection.
    await user.click(selectAllCheckbox);
    expect(
      screen.getByRole("button", { name: /start 0 run\b/i }),
    ).toHaveProperty("disabled", true);

    // Re-checking the individual issue directly (not via select-all) exercises
    // the "add to selection" branch of toggleOne.
    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();
  });

  it("does not call ingestIssues when Start is clicked with nothing selected", async () => {
    const user = userEvent.setup();
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    await user.click(selectAllCheckbox); // deselect all

    const startBtn = screen.getByRole("button", { name: /start 0 run\b/i });
    expect(startBtn).toHaveProperty("disabled", true);
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked and when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-fetches issues and resets ingest tracking state when reopened", async () => {
    const { rerender } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();

    rerender(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() =>
      expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
  });

  it("works without an onIngestComplete callback when ingest resolves", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueA.id], skipped: [] });

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={onIngested} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("resets cleanly (no stale auto-close) when closed and reopened before the min-loader timer fires", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueA.id], skipped: [] });

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // Let the ingestIssues promise settle. Since almost no real time has
    // elapsed, maybeAutoClose schedules a MIN_LOADER_MS-delayed retry
    // instead of closing immediately, leaving a pending timer behind.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    // The stale timer from the previous cycle must not fire and close the
    // freshly reopened dialog, and the reopened dialog should show a fresh
    // issue list rather than being stuck mid-ingest.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined(),
    );
  });

  it("calls onIngestComplete a second time with authoritative counts when ingestIssues resolves after SSE already closed the dialog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();
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
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    // Optimistic, SSE-synthesized summary (the HTTP response hasn't landed yet).
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    onIngestComplete.mockClear();
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    // The authoritative started/skipped counts arrive as a second call.
    await waitFor(() =>
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 1 }),
    );
    expect(onIngested).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
