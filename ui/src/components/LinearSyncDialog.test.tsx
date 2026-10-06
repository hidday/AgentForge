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

  it("shows a loading state while issues are being fetched", async () => {
    let resolveFetch!: (v: { issues: typeof issueA[] }) => void;
    mockApi.fetchPendingIssues.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    expect(screen.getByText(/fetching issues from linear/i)).toBeDefined();

    await act(async () => {
      resolveFetch({ issues: [issueA, issueB] });
    });

    await waitFor(() => {
      expect(screen.queryByText(/fetching issues from linear/i)).toBeNull();
      expect(screen.getByText(issueA.title)).toBeDefined();
    });
  });

  it("shows an error state when fetchPendingIssues rejects", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
    // No issue list or start button in the error state
    expect(screen.queryByRole("button", { name: /start \d+ run/i })).toBeNull();
  });

  it("shows an empty state with no start button when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no pending issues found/i)).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /start \d+ run/i })).toBeNull();
  });

  it("renders project, labels, and a known priority for each issue", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          ...issueA,
          project: "Core",
          labels: ["bug", "urgent-ish"],
          priority: 1, // Urgent
        },
      ],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByText("Core")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-ish")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
    expect(screen.getByText(issueA.id.slice(0, 8))).toBeDefined();
  });

  it("falls back to the 'None' priority label for an unmapped priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("None")).toBeDefined();
  });

  it("toggleOne deselects a single issue, updating the Start N Runs label", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const checkboxes = screen.getAllByRole("checkbox");
    // checkboxes[0] is "select all"; issue checkboxes follow in order.
    await userEvent.click(checkboxes[1]);

    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();
  });

  it("toggleAll deselects then reselects every issue via the header checkbox", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const selectAll = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(selectAll.checked).toBe(true);

    await userEvent.click(selectAll);
    expect(screen.getByRole("button", { name: /^start 0 run$/i })).toBeDefined();
    expect(selectAll.checked).toBe(false);

    await userEvent.click(selectAll);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
    expect(selectAll.checked).toBe(true);
  });

  it("the Start button is disabled once every issue is deselected", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const selectAll = screen.getAllByRole("checkbox")[0];
    await userEvent.click(selectAll);

    const startBtn = screen.getByRole("button", { name: /^start 0 run$/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("the refresh button re-fetches issues and shows a spinning icon while loading", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    let resolveRefetch!: (v: { issues: typeof issueA[] }) => void;
    mockApi.fetchPendingIssues.mockReturnValue(
      new Promise((res) => {
        resolveRefetch = res;
      }),
    );

    const refreshBtn = screen.getByTitle("Refresh");
    await userEvent.click(refreshBtn);

    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/fetching issues from linear/i)).toBeDefined();
    expect(refreshBtn.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");

    await act(async () => {
      resolveRefetch({ issues: [issueA, issueB] });
    });

    await waitFor(() => {
      expect(screen.queryByText(/fetching issues from linear/i)).toBeNull();
    });
  });

  it("Cancel calls onClose without starting an ingest", async () => {
    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("clicking the backdrop calls onClose", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("toggleOne can re-select an issue it previously deselected", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[1]); // deselect issueA
    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();

    await userEvent.click(checkboxes[1]); // re-select issueA
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a pending min-delay auto-close timer when the dialog is closed and reopened", async () => {
    const onClose = vi.fn();
    const onIngestComplete = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // First cycle never resolves over HTTP — only the SSE path matters here.
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    // Both issues observed via SSE immediately, but we're still inside the
    // MIN_LOADER_MS window, so the close is scheduled rather than immediate.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // Parent closes the dialog before the scheduled close can fire...
    rerender(
      <LinearSyncDialog
        open={false}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );
    // ...and reopens it. The reopen effect must clear the stale timer so it
    // can never fire against the new (unrelated) dialog cycle.
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // Advance well past MIN_LOADER_MS — if the stale timer survived, this
    // would spuriously close the freshly-reopened dialog.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires an optimistic onIngestComplete from SSE, then an authoritative one once ingestIssues resolves", async () => {
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

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

    // SSE confirms both runs before the HTTP response lands.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      // Optimistic summary, synthesized from the pending ids.
      expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });
    });

    // The authoritative HTTP response now resolves.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id, issueB.id], skipped: [] });
    });

    await waitFor(() => {
      expect(onIngested).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
      expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 2, skipped: 0 });
    });
    // onClose is only ever triggered once, from the SSE-driven path.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onIngested when ingestIssues resolves with nothing started", async () => {
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

  describe("SSE event filtering", () => {
    it("ignores events that are not 'run:created', events without an issueId, and events for issues outside the current batch", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

      render(
        <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
      );
      await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

      await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

      // None of these should move the needle toward auto-closing.
      fireSSE({ type: "process:started" } as unknown as DashboardEvent);
      fireSSE({ type: "run:created" } as unknown as DashboardEvent); // no issueId
      fireSSE({ type: "run:created", runId: "run-x", issueId: "not-in-batch" });

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(onClose).not.toHaveBeenCalled();

      // Completing the real batch still closes the dialog normally.
      fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
      fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    });

    it("ignores a duplicate run:created event for an issue already observed, without scheduling a second close", async () => {
      const onClose = vi.fn();
      const onIngestComplete = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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

      await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

      fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
      fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
      // Duplicate — already seen, and a close is already scheduled.
      fireSSE({ type: "run:created", runId: "run-a-again", issueId: issueA.id });
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      // Closes exactly once, with the correct (non-duplicated) summary.
      await waitFor(() => {
        expect(onClose).toHaveBeenCalledOnce();
        expect(onIngestComplete).toHaveBeenCalledOnce();
        expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });
      });
    });
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });
});
