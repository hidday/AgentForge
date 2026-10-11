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
  labels: ["backend"],
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

const issueWithProjectAndUnknownPriority = {
  id: "issue-c",
  title: "Third issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 99,
  project: "Platform",
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing and never fetches issues when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows a generic error message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValueOnce("network boom");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("shows the Error's message when fetchPendingIssues rejects with an Error instance", async () => {
    mockApi.fetchPendingIssues.mockRejectedValueOnce(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("toggling 'Select all' deselects then reselects every issue, updating the Start button label", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // All selected by default.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAll = screen.getByLabelText(/select all/i) as HTMLInputElement;
    expect(selectAll.checked).toBe(true);

    await user.click(selectAll);
    expect(selectAll.checked).toBe(false);
    const startBtn = screen.getByRole("button", { name: /^start 0 run$/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);

    await user.click(selectAll);
    expect(selectAll.checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggling a single issue checkbox updates selection and uses singular 'Run' label for one item", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueACheckbox = screen.getByText(issueA.title)
      .closest("label")!
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(issueACheckbox.checked).toBe(true);

    await user.click(issueACheckbox);
    expect(issueACheckbox.checked).toBe(false);

    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();

    // Re-check it to get back to 2 selected.
    await user.click(issueACheckbox);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("renders issue labels as badges", async () => {
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("backend")).toBeDefined();
  });

  it("ignores SSE events that are not run:created, lack an issueId, or reference an issue outside the current batch", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));
    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();

    // Unrelated event type — ignored.
    fireSSE({ type: "run:updated", runId: "run-x" } as unknown as DashboardEvent);
    // run:created with no issueId — ignored.
    fireSSE({ type: "run:created", runId: "run-y" } as unknown as DashboardEvent);
    // run:created for an issue outside this ingest batch — ignored.
    fireSSE({ type: "run:created", runId: "run-z", issueId: "unrelated-issue" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of the pending issues were observed, so the dialog must still be open.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();
  });

  it("calls onIngestComplete a second time with authoritative counts once the HTTP response lands after an SSE-triggered close", async () => {
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

    // Both issues observed via SSE before the HTTP response resolves.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });
    });

    // Now the HTTP response lands with the authoritative (different) counts.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngested).toHaveBeenCalledOnce();
      expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not schedule a second delayed close when one is already pending for the same batch", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    // A duplicate event for an already-seen issue re-enters maybeAutoClose
    // while the delayed close is already scheduled.
    fireSSE({ type: "run:created", runId: "run-a-2", issueId: issueA.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("clears a pending delayed close timer when the dialog is closed and reopened before it fires", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Both seen quickly, before MIN_LOADER_MS elapses, so a delayed close
    // timer gets scheduled instead of closing immediately.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    clearTimeoutSpy.mockClear();

    // Parent closes, then reopens the dialog before the scheduled close fires.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    expect(clearTimeoutSpy).toHaveBeenCalled();

    // Advancing time well past the original schedule must not trigger the
    // stale close, because it was cleared on reopen.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("harmlessly no-ops a stale scheduled auto-close once pending ids were reset by an ingest error", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    let rejectIngest!: (err: Error) => void;
    mockApi.ingestIssues.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectIngest = reject;
      }),
    );

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Both seen quickly, scheduling a delayed close (MIN_LOADER_MS not yet elapsed).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // The HTTP request then fails, before the scheduled timer fires. This
    // resets pendingIdsRef to [] without clearing the pending timer.
    await act(async () => {
      rejectIngest(new Error("Linear unreachable"));
    });
    await waitFor(() => {
      expect(screen.getByText("Linear unreachable")).toBeDefined();
    });

    // Now let the stale scheduled timer fire — it should no-op harmlessly.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Linear unreachable")).toBeDefined();
  });

  it("shows a generic error message when ingestIssues rejects with a non-Error value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockRejectedValue("some rejection string");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to ingest issues")).toBeDefined();
    });
  });

  it("falls back to the 'None' priority style for an issue with an unrecognized priority, and shows its project badge", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [issueWithProjectAndUnknownPriority],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(issueWithProjectAndUnknownPriority.title)).toBeDefined(),
    );

    expect(screen.getByText("None")).toBeDefined();
    expect(screen.getByText("Platform")).toBeDefined();
  });

  it("clears a pending delayed close timer on unmount", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    clearTimeoutSpy.mockClear();
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
