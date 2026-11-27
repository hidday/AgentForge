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

  it("fires a second onIngestComplete with authoritative counts after SSE already auto-closed the dialog", async () => {
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

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // SSE observes both issues before the HTTP response lands, and enough
    // time has passed for the min-loader delay — this closes the dialog
    // with a synthesized summary (started = pendingIds.length, skipped = 0).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // Now the HTTP response resolves with the authoritative counts. Because
    // closedRef is already true, the dialog fires a second onIngestComplete
    // with the real started/skipped counts, plus onIngested.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id, issueB.id], skipped: [] });
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
    });
    expect(onIngestComplete).toHaveBeenLastCalledWith({ started: 2, skipped: 0 });
    expect(onIngested).toHaveBeenCalledOnce();
    // onClose is not called again — the dialog is already closed.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders an issue's project and labels, and lets a single issue be deselected via its checkbox", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const issueWithExtras = {
      ...issueA,
      project: "Platform",
      labels: ["bug", "urgent-fix"],
    };
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithExtras, issueB] });

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueWithExtras.title)).toBeDefined());

    expect(screen.getByText("Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();

    // Both issues start selected -> "Start 2 Runs"
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Deselect just the first issue via its own checkbox.
    const checkboxes = screen.getAllByRole("checkbox");
    // checkboxes[0] is "select all"; issue checkboxes follow in order.
    await user.click(checkboxes[1]!);

    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    // Re-selecting via "select all" should bring it back to 2.
    await user.click(checkboxes[0]!);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("deselects all issues via the select-all checkbox when everything is already selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAll = screen.getAllByRole("checkbox")[0]!;
    await user.click(selectAll);

    const startBtn = screen.getByRole("button", { name: /start 0 run/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("re-selects a single issue via its own checkbox after deselecting it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueCheckbox = screen.getAllByRole("checkbox")[1]!;
    await user.click(issueCheckbox); // deselect
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    await user.click(issueCheckbox); // re-select
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("surfaces a generic error message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockReset();
    mockApi.fetchPendingIssues.mockRejectedValue("network down");

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("clears a pending min-loader timer when the dialog closes and reopens before it fires", async () => {
    const onIngestComplete = vi.fn();

    // Never resolves — auto-close for this test is driven purely by SSE,
    // so the min-loader timer is still pending when we reopen the dialog.
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE observes both issues immediately, well before MIN_LOADER_MS has
    // elapsed, so maybeAutoClose schedules (but does not yet fire) the
    // min-delay timer.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Close and reopen the dialog (as the parent would after onClose) before
    // the scheduled timer has a chance to fire. The re-open effect must
    // clear the stale timer so it never calls onIngestComplete later.
    rerender(
      <LinearSyncDialog
        open={false}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );
    rerender(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // The stale timer was cleared on reopen, so the earlier ingest cycle's
    // onIngestComplete should never fire.
    expect(onIngestComplete).not.toHaveBeenCalled();
  });

  it("surfaces the Error.message when fetchPendingIssues rejects with a real Error", async () => {
    mockApi.fetchPendingIssues.mockReset();
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("network timeout"));

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("network timeout")).toBeDefined();
    });
  });

  it("surfaces a generic error message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("linear 500");

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("does not call onIngested when the ingest response starts zero runs", async () => {
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
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("falls back to the default (None) priority label for a priority value outside the known map", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }],
    });

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("None")).toBeDefined();
  });

  it("ignores SSE events that aren't run:created, that lack an issueId, or whose issueId isn't pending", async () => {
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
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Wrong event type — ignored.
    fireSSE({ type: "process:started", runId: "run-x" });
    // run:created with no issueId — ignored.
    fireSSE({ type: "run:created", runId: "run-x" });
    // run:created for an issue that isn't pending — ignored.
    fireSSE({ type: "run:created", runId: "run-x", issueId: "some-other-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of the above should have triggered an auto-close.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears a pending min-loader timer on unmount so it never fires after teardown", async () => {
    const onIngestComplete = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE observes both issues well before MIN_LOADER_MS elapses, scheduling
    // (but not yet firing) the min-delay timer.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onIngestComplete).not.toHaveBeenCalled();
  });

  it("does not reschedule the min-loader timer when a duplicate SSE event arrives while one is already pending", async () => {
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

    // Select only issueA so a single SSE event makes `allSeen` true.
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[2]!); // deselect issueB
    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    // First run:created for issueA schedules the min-delay timer (not yet
    // elapsed). A duplicate delivery of the same event must hit the
    // "already scheduled" guard instead of scheduling a second timer.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Closes exactly once, with the single-issue summary — proving the
    // duplicate event didn't schedule (or fire) a second close.
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(onIngestComplete).toHaveBeenCalledOnce();
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 0 });
  });
});
