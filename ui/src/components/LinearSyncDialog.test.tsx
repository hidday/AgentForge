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

  it("fires a second onIngestComplete with authoritative counts when the HTTP response settles after SSE already auto-closed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    let resolveIngest!: (value: { ok: boolean; started: string[]; skipped: string[] }) => void;
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

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // SSE observes both issues and, after the min-loader delay, auto-closes
    // optimistically (onIngestComplete called once with synthesized counts).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });
    });

    // Now the authoritative HTTP response lands, with one actually skipped.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("renders each issue's project badge and labels, and allows deselecting a single issue", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        { ...issueA, project: "Core Platform", labels: ["bug", "urgent-fix"] },
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

    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();

    // Both selected by default -> "Select all" checked, Start shows count 2.
    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    expect(selectAllCheckbox).toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Deselect issue A individually.
    const issueACheckbox = screen
      .getByText(issueA.title)
      .closest("label")!
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    await userEvent.click(issueACheckbox);

    expect(screen.getByRole("button", { name: /start 1 run$/i })).toBeDefined();
    expect(selectAllCheckbox).toHaveProperty("checked", false);

    // Re-check it to exercise toggleOne's "add back" branch.
    await userEvent.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggles all issues selected/unselected via the 'Select all' checkbox", async () => {
    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    await userEvent.click(selectAllCheckbox);
    expect(screen.getByRole("button", { name: /^start 0 run$/i })).toBeDefined();

    await userEvent.click(selectAllCheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a pending min-delay auto-close timer when the dialog closes and reopens mid-ingest", async () => {
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await act(async () => {
      await userEvent.click(startBtn, { advanceTimers: vi.advanceTimersByTime });
    });

    // Both observed immediately -> schedules the min-delay timer (not yet fired).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // Close then reopen before the scheduled timer fires: this clears the
    // stale timer and resets ingest tracking (including re-fetching issues).
    rerender(
      <LinearSyncDialog
        open={false}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );
    rerender(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // The stale timer must not have fired and triggered a close.
    expect(onClose).not.toHaveBeenCalled();
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events that aren't a 'run:created' for a pending issue, and before an ingest cycle starts", async () => {
    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // No ingest cycle started yet (pendingIdsRef empty) -> no-op, no throw.
    expect(() =>
      fireSSE({ type: "run:created", runId: "run-x", issueId: issueA.id }),
    ).not.toThrow();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Wrong event type -> ignored.
    expect(() => fireSSE({ type: "process:started", runId: "run-x" })).not.toThrow();
    // No issueId on the event -> ignored.
    expect(() => fireSSE({ type: "run:created", runId: "run-x" })).not.toThrow();
    // issueId not part of this ingest cycle -> ignored.
    expect(() =>
      fireSSE({ type: "run:created", runId: "run-x", issueId: "unrelated-issue" }),
    ).not.toThrow();

    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();
  });

  it("ignores a maybeAutoClose trigger that arrives after the dialog has already closed for this cycle", async () => {
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

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    // A further SSE event after the cycle already closed must be a no-op.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onIngestComplete).toHaveBeenCalledOnce();
  });

  it("does not reschedule the min-delay timer when a duplicate SSE event arrives while one is already pending", async () => {
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

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // Timer is now scheduled but hasn't fired; a repeat event for an
    // already-seen issue re-enters maybeAutoClose and must hit the
    // "already scheduled" guard rather than scheduling a second timer.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
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

  it("falls back to a generic message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("plain string failure");

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

  it("falls back to a generic message when ingestIssues rejects with a non-Error value", async () => {
    mockApi.ingestIssues.mockRejectedValue("plain string failure");

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
        onIngestComplete={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("falls back to the 'None' priority style for a priority value with no mapping", async () => {
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

  it("does not call onIngested when nothing actually started (all skipped)", async () => {
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
        onClose={vi.fn()}
        onIngested={onIngested}
        onIngestComplete={onIngestComplete}
      />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 2 });
    });
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("clears a pending min-delay timer on unmount so it never fires after teardown", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Min-delay timer is now pending; unmount before it fires.
    expect(() => unmount()).not.toThrow();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
