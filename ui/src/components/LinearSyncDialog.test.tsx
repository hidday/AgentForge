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

  it("shows a generic error when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("some non-Error rejection");

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

  it("fires a second onIngestComplete with authoritative counts when ingestIssues resolves after SSE already auto-closed the dialog", async () => {
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

    // Both issues observed via SSE, and past the min-loader delay: triggers
    // the SSE-driven auto-close path first, with a synthesized summary.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });
    });

    // Now the slow HTTP response finally lands, with the authoritative
    // (different) counts — the dialog is already closed, but handleIngest
    // still fires onIngested + a second onIngestComplete with real numbers.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngested).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    });
    // onClose was not called again — the dialog only auto-closes once.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders an issue's project badge and labels, and toggling its own checkbox updates selection independently", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          ...issueA,
          project: "Backend Platform",
          labels: ["bug", "urgent"],
        },
        issueB,
      ],
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

    expect(screen.getByText("Backend Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent")).toBeDefined();

    // Both issues start selected ("Start 2 runs"); unchecking just issueA's
    // own checkbox (not select-all) should drop the count to 1.
    const issueACheckbox = screen.getByText(issueA.title).closest("label")!.querySelector(
      "input[type=checkbox]",
    )!;
    await user.click(issueACheckbox);

    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog
        open={false}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows an error message when fetchPendingIssues rejects", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("shows a generic error message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("some non-Error rejection");

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

  it("'select all' checkbox selects everything when some issues are currently deselected", async () => {
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

    // Deselect one issue first so not everything is selected.
    const issueACheckbox = screen.getByText(issueA.title).closest("label")!.querySelector(
      "input[type=checkbox]",
    )!;
    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    // Clicking "select all" while not everything is selected re-selects all.
    await user.click(screen.getByLabelText(/select all/i));
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("does not schedule a second min-delay timer when maybeAutoClose is re-triggered while one is already pending", async () => {
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
    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Both seen -> schedules the min-delay timer (closedRef not yet set).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // A duplicate event for an already-seen id re-invokes maybeAutoClose
    // while the timer from above is already pending ("already scheduled").
    fireSSE({ type: "run:created", runId: "run-a-dup", issueId: issueA.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("clears a pending min-delay timer when the dialog closes and re-opens before it fires", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Schedule the min-delay timer (both seen, well within the window).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Close and re-open before the timer fires — the re-open effect should
    // clear the stale pending timer rather than leaving it dangling.
    rerender(
      <LinearSyncDialog
        open={false}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    // No crash, and the fresh cycle starts clean (not pre-closed).
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
  });

  it("clears a pending min-delay timer on unmount", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Unmounting while the min-delay timer is pending must not throw.
    expect(() => unmount()).not.toThrow();
  });

  it("'select all' checkbox deselects everything when all issues are already selected", async () => {
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

    await user.click(screen.getByLabelText(/select all/i));

    expect(screen.getByRole("button", { name: /start 0 run\b/i })).toBeDefined();
  });

  it("toggling a single issue's checkbox off and back on re-selects it", async () => {
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
    const issueACheckbox = screen.getByText(issueA.title).closest("label")!.querySelector(
      "input[type=checkbox]",
    )!;

    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("falls back to the 'None' priority label for an unrecognized priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }, issueB],
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

  it("ignores SSE events unrelated to the current ingest: wrong type, missing issueId, or an id not pending", async () => {
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

    // Before clicking Start, pendingIdsRef is empty — maybeAutoClose should
    // bail out early (no pending ids) rather than closing the dialog.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    expect(onClose).not.toHaveBeenCalled();

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Wrong event type — ignored.
    fireSSE({ type: "process:started", runId: "run-x", issueId: issueA.id } as never);
    // No issueId on a run:created event — ignored.
    fireSSE({ type: "run:created", runId: "run-y", issueId: undefined });
    // issueId not among the ones we're waiting on — ignored.
    fireSSE({ type: "run:created", runId: "run-z", issueId: "not-pending" });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
