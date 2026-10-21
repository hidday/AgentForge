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

  it("shows a loading state while fetching, then an empty state when there are no issues", async () => {
    let resolveFetch!: (v: { issues: (typeof issueA)[] }) => void;
    mockApi.fetchPendingIssues.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      <LinearSyncDialog
        open={true}
        onClose={vi.fn()}
        onIngested={vi.fn()}
      />,
    );

    expect(screen.getByText(/Fetching issues from Linear/i)).toBeDefined();

    resolveFetch({ issues: [] });

    await waitFor(() => {
      expect(screen.getByText(/No pending issues found/i)).toBeDefined();
    });
    // No issue rows and no Start button when the list is empty.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("renders each issue's project badge, label badges, and priority, falling back to 'None' for an unknown priority", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        { ...issueA, project: "Backend Platform", labels: ["bug", "api"], priority: 2 },
        { ...issueB, project: undefined, labels: [], priority: 99 },
      ],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByText("Backend Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("api")).toBeDefined();
    expect(screen.getByText("High")).toBeDefined(); // priority 2
    expect(screen.getByText("None")).toBeDefined(); // unmapped priority 99 falls back to label 0
  });

  it("toggles individual issues and the select-all checkbox", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // Both selected by default.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAll = screen.getByLabelText(/select all/i);
    await user.click(selectAll);
    expect(screen.getByRole("button", { name: /start/i }).hasAttribute("disabled")).toBe(true);

    await user.click(selectAll);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const issueACheckbox = screen.getByText(issueA.title).closest("label")!
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 1 run/i })).toBeDefined();
  });

  it("re-fetches on refresh click and closes on cancel click without ingesting", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledOnce();

    await user.click(screen.getByTitle("Refresh"));
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", async () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("fires a second onIngestComplete with authoritative counts when the HTTP response settles after SSE already auto-closed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
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
        onIngested={onIngested}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE delivers both issues and the min-loader delay elapses: auto-close
    // fires from the SSE path with an optimistic summary.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // The HTTP response for /linear/ingest now resolves with the
    // authoritative counts (one of the two actually got skipped) — the
    // component should fire onIngested + a second, corrected
    // onIngestComplete even though the dialog already closed.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngested).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
      expect(onIngestComplete).toHaveBeenLastCalledWith({ started: 1, skipped: 1 });
    });
    // Still only closed once.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("surfaces an error when the initial issue fetch fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Linear API down/i)).toBeDefined();
    });
  });

  it("re-checking a previously-unchecked issue adds it back to the selection", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueACheckbox = screen.getByText(issueA.title).closest("label")!
      .querySelector("input[type=checkbox]") as HTMLInputElement;

    await user.click(issueACheckbox); // uncheck -> 1 selected
    expect(screen.getByRole("button", { name: /start 1 run/i })).toBeDefined();

    await user.click(issueACheckbox); // re-check -> 2 selected
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a pending min-loader-delay timer when the dialog is closed and reopened mid-cycle", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE sees both issues immediately, but MIN_LOADER_MS hasn't elapsed yet,
    // so maybeAutoClose schedules a follow-up timer instead of closing now.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // Close and reopen before the scheduled timer fires: the re-open effect
    // must clear the stale pending timer rather than leak it.
    rerender(
      <LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />,
    );
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // The stale timer was cleared on reopen, so no stray auto-close fires.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when Start is clicked with no issues selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByLabelText(/select all/i)); // deselect all

    const startBtn = screen.getByRole("button", { name: /start/i });
    expect(startBtn.hasAttribute("disabled")).toBe(true);
    await user.click(startBtn);
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });
});
