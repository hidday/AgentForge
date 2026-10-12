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
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a loading indicator while fetching issues", async () => {
    let resolveFetch!: (v: { issues: typeof issueA[] }) => void;
    mockApi.fetchPendingIssues.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    expect(screen.getByText(/fetching issues from linear/i)).toBeDefined();

    await act(async () => {
      resolveFetch({ issues: [] });
    });

    await waitFor(() => {
      expect(screen.queryByText(/fetching issues from linear/i)).toBeNull();
    });
  });

  it("shows an error message when fetching issues fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("shows a non-Error-message fallback when fetching issues fails with a non-Error", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("network down");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("shows an empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/no pending issues found/i)).toBeDefined();
    });
    // No Start button when there are no issues to select from.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("renders issue metadata (project, labels, priority) and supports per-issue and select-all toggling", async () => {
    const richIssue = {
      id: "issue-rich",
      title: "Rich issue",
      description: "",
      state: "Todo",
      labels: ["backend", "urgent-fix"],
      priority: 1,
      project: "Core Platform",
    };
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [richIssue, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Rich issue")).toBeDefined());

    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
    expect(screen.getByText(richIssue.id.slice(0, 8))).toBeDefined();

    // Both issues selected by default.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // checkboxes[0] is "select all"; 1 and 2 are the per-issue boxes.
    const selectAll = checkboxes[0];
    const richCheckbox = checkboxes[1];

    // Deselect one issue individually.
    await userEvent.click(richCheckbox);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();
    expect((selectAll as HTMLInputElement).checked).toBe(false);

    // Re-select it via its own checkbox.
    await userEvent.click(richCheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Toggle all off, then all back on.
    await userEvent.click(selectAll);
    expect(screen.getByRole("button", { name: /start 0 run\b/i })).toBeDefined();
    expect(
      (screen.getByRole("button", { name: /start 0 run\b/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await userEvent.click(selectAll);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("falls back to the 'None' priority label for an issue with an unmapped priority value", async () => {
    const weirdPriorityIssue = { ...issueA, id: "issue-weird", priority: 99 };
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [weirdPriorityIssue] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(weirdPriorityIssue.title)).toBeDefined());
    expect(screen.getByText("None")).toBeDefined();
  });

  it("calls onClose when Cancel or the backdrop is clicked, and refetches on Refresh", async () => {
    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("fires onIngestComplete a second time with authoritative counts once ingestIssues resolves after an SSE-triggered close", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();
    let resolveIngest!: (v: { ok: true; started: string[]; skipped: string[] }) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((resolve) => {
        resolveIngest = resolve;
      }),
    );

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

    // SSE observes both issues before the HTTP request settles, and enough
    // time has passed, so maybeAutoClose closes optimistically.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // Now the authoritative HTTP response lands, with different counts.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 1 });
    });
    expect(onIngestComplete).toHaveBeenCalledTimes(2);
  });

  it("clears a pending min-delay timer when the dialog is closed and reopened mid-ingest", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE observes both issues immediately, but we're still inside the
    // MIN_LOADER_MS window, so maybeAutoClose schedules a follow-up timer
    // instead of closing right away.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Close then reopen before the scheduled timer fires — this must clear
    // the stale timer rather than leaking it.
    rerender(<LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />);
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // No crash and the dialog is back in its normal (non-ingesting) state.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("ignores SSE events that are not run:created or whose issueId is not pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Wrong event type: ignored.
    fireSSE({ type: "run:state-changed", runId: "run-x" } as unknown as DashboardEvent);
    // Missing issueId: ignored.
    fireSSE({ type: "run:created", runId: "run-y" });
    // issueId not among the pending set: ignored.
    fireSSE({ type: "run:created", runId: "run-z", issueId: "not-pending" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
