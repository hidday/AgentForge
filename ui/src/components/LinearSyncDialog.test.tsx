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

const issueWithExtras = {
  id: "issue-c",
  title: "Third issue",
  description: "",
  state: "Todo",
  labels: ["bug", "urgent"],
  priority: 99, // not in PRIORITY_LABELS -> should fall back to the default
  project: "Infra",
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

  it("shows a generic error message when ingest rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("socket hang up");

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to ingest issues/i)).toBeDefined();
    });
  });

  it("does not render anything and does not fetch issues while closed", async () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows an error when the initial issue fetch fails with an Error", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Linear API down/i)).toBeDefined();
    });
  });

  it("shows a fallback error message when the initial issue fetch rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("boom");

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/failed to fetch issues/i)).toBeDefined();
    });
  });

  it("clears a pending min-loader timer when the dialog is reopened mid-flight", async () => {
    const onClose = vi.fn();
    // Never resolves -- the close in this test must come purely from SSE.
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Both issues observed right away: schedules a delayed close because the
    // min-loader window (600ms) hasn't elapsed yet.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // The dialog is closed and reopened before that timer fires. Reopening
    // must clear the stale timer so it cannot fire against a fresh cycle.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the pending min-loader timer when the dialog unmounts mid-flight", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    clearTimeoutSpy.mockClear();
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("ignores SSE events that aren't run:created, lack an issueId, or reference an untracked issue", async () => {
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // None of these should move the dialog toward closing.
    fireSSE({ type: "run:state-changed", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-x" });
    fireSSE({ type: "run:created", runId: "run-z", issueId: "issue-unrelated" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();

    // Now deliver the real events; the dialog should close normally,
    // confirming the SSE handling itself still works after the noise.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("does not schedule a second min-loader timer when the ingest response settles while one is already pending", async () => {
    const onClose = vi.fn();
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
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE observes both issues right away -> schedules the delayed close.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // The HTTP response settles before the loader's minimum delay elapses.
    // The resulting maybeAutoClose() call must see the already-pending timer
    // and bail out instead of scheduling a duplicate one.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id, issueB.id], skipped: [] });
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // A duplicate timer would have caused onClose/onIngestComplete to fire
    // more than once.
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledOnce();
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });
  });

  it("reports the authoritative counts a second time once the HTTP response settles after SSE already closed the dialog", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Let the min-loader window fully elapse so the scheduled timer fires and
    // closes the dialog (closedRef becomes true) BEFORE the HTTP response
    // settles. Since ingestResultRef is still empty at this point, the
    // summary falls back to the pending-id count.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // Now the HTTP response settles with the authoritative counts. The
    // maybeAutoClose() call inside handleIngest must bail out immediately
    // (closedRef already true) without a second onClose, while the real
    // counts are still reported via a second onIngestComplete call.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => expect(onIngestComplete).toHaveBeenCalledTimes(2));
    expect(onIngestComplete).toHaveBeenLastCalledWith({ started: 1, skipped: 1 });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it("does not call onIngested when the ingest response reports zero started issues", async () => {
    const onClose = vi.fn();
    const onIngested = vi.fn();
    mockApi.ingestIssues.mockResolvedValue({
      ok: true,
      started: [],
      skipped: [issueA.id, issueB.id],
    });

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={onIngested} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Let the resolved ingestIssues promise settle, then let the min-loader
    // window elapse so the dialog auto-closes from the settled response.
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("toggles select-all to deselect and reselect every issue", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // All selected -> unchecking deselects everything.
    await user.click(selectAllCheckbox);
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: /^start 0 run$/i })).toBeDefined();
    expect(
      (screen.getByRole("button", { name: /^start 0 run$/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // None selected -> checking selects everything again.
    await user.click(selectAllCheckbox);
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggles a single issue off and on, updating the selection count and button pluralization", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueACheckbox = screen.getByRole("checkbox", { name: new RegExp(issueA.title) });
    expect((issueACheckbox as HTMLInputElement).checked).toBe(true);

    await user.click(issueACheckbox);
    expect((issueACheckbox as HTMLInputElement).checked).toBe(false);
    // Singular "Run" (no trailing "s") when exactly one issue is selected.
    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();

    await user.click(issueACheckbox);
    expect((issueACheckbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("renders the project badge, an unknown-priority fallback, and issue labels", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueWithExtras] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueWithExtras.title)).toBeDefined());

    expect(screen.getByText("Infra")).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent")).toBeDefined();
  });
});
