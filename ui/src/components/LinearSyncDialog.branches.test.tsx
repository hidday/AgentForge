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
  labels: ["bug", "backend"],
  priority: 1,
  project: "Core Platform",
};

const issueB = {
  id: "issue-b",
  title: "Second issue",
  description: "",
  state: "Todo",
  labels: [],
  priority: 0,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows a loading spinner while issues are being fetched", async () => {
    let resolveFetch!: (v: { issues: typeof issueA[] }) => void;
    mockApi.fetchPendingIssues.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
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

  it("shows a generic error message when the rejection is not an Error instance", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("plain string failure");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch issues/i)).toBeDefined();
    });
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No pending issues found")).toBeDefined();
    });
    // No footer start button when there are no issues.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("renders each issue's project badge, priority label, and labels", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined(); // priority 1
    expect(screen.getByText("None")).toBeDefined(); // priority 0 (issueB)
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
  });

  it("does not render a project badge for an issue with no project", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueB.title)).toBeDefined());
    expect(screen.queryByText("Core Platform")).toBeNull();
  });

  it("selects all issues by default and shows the plural Start N Runs label", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(true);
  });

  it("deselecting one issue via toggleOne updates selection count and singular/plural label", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // checkboxes[0] is "select all"; 1 and 2 are the two issues.
    await userEvent.click(checkboxes[1]);

    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    // Re-checking it should bring the count back to plural.
    await userEvent.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggleAll unchecks every issue, then re-checking selects them all again", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getByRole("checkbox", {
      name: /select all/i,
    }) as HTMLInputElement;

    await userEvent.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(false);
    // Start button disabled when nothing is selected.
    expect(
      (screen.getByRole("button", { name: /start 0 run\b/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await userEvent.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("the refresh button re-fetches issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTitle("Refresh"));

    await waitFor(() => {
      expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
    });
  });

  it("calls onClose when the Cancel button is clicked", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    const onClose = vi.fn();

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    const onClose = vi.fn();

    const { container } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const backdrop = container.querySelector(".bg-black\\/60");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores SSE events whose type is not run:created", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 1 run/i }));

    fireSSE({ type: "run:updated", runId: "run-a" } as unknown as DashboardEvent);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores run:created SSE events with no issueId", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 1 run/i }));

    fireSSE({ type: "run:created", runId: "run-a" } as unknown as DashboardEvent);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores run:created SSE events for an issue that was not part of this ingest", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 1 run/i }));

    fireSSE({ type: "run:created", runId: "run-x", issueId: "some-other-issue" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets selection and ingest tracking state each time the dialog re-opens", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    rerender(<LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    // Selection resets back to "all selected" on reopen.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a stale pending min-delay timer when the dialog is closed and reopened mid-ingest", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
      mockApi.ingestIssues.mockResolvedValue({
        ok: true,
        started: [issueA.id],
        skipped: [],
      });

      const { rerender } = render(
        <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
      );
      await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

      await user.click(screen.getByRole("button", { name: /start 1 run/i }));

      // ingestIssues resolves almost immediately, well under MIN_LOADER_MS,
      // so a real min-delay timer gets scheduled (minDelayTimerRef is set).
      await waitFor(() => {
        expect(mockApi.ingestIssues).toHaveBeenCalled();
      });

      // Re-opening the dialog before that timer fires must clear it (the
      // `if (minDelayTimerRef.current)` branch in the open-reset effect).
      rerender(<LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />);
      rerender(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

      await waitFor(() => {
        expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
      });

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a final onIngestComplete with authoritative counts after SSE already auto-closed, once the HTTP response resolves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onClose = vi.fn();
      const onIngested = vi.fn();
      const onIngestComplete = vi.fn();

      mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
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

      await user.click(screen.getByRole("button", { name: /start 1 run/i }));

      // SSE observes the run before the HTTP response lands, and enough
      // time passes that maybeAutoClose closes the dialog from the SSE path.
      fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledOnce();
      });
      // The authoritative HTTP response resolves after the optimistic close.
      await act(async () => {
        resolveIngest({ ok: true, started: [issueA.id], skipped: [] });
      });

      await waitFor(() => {
        expect(onIngested).toHaveBeenCalledOnce();
        expect(onIngestComplete).toHaveBeenCalledWith({ started: 1, skipped: 0 });
      });
      // Called twice: once from the optimistic SSE close, once with the
      // authoritative HTTP counts.
      expect(onIngestComplete).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a generic error message when ingestIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockRejectedValue("not an Error instance");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 1 run/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to ingest issues/i)).toBeDefined();
    });
  });

  it("does not call onIngested when the ingest response started no runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onIngested = vi.fn();
      mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
      mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [issueA.id] });

      render(
        <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={onIngested} />,
      );
      await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

      await user.click(screen.getByRole("button", { name: /start 1 run/i }));

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      await waitFor(() => {
        expect(mockApi.ingestIssues).toHaveBeenCalled();
      });
      expect(onIngested).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the 'None' priority label for an unrecognized priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("None")).toBeDefined();
  });

  it("maybeAutoClose is a no-op once pendingIdsRef has been reset (e.g. after a failed ingest)", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 1 run/i }));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeDefined();
    });

    // pendingIdsRef.current was reset to [] on the error path. A stray SSE
    // event delivered afterwards must not throw or close the dialog.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a second SSE-triggered auto-close attempt while a min-delay timer is already scheduled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const onClose = vi.fn();
      const onIngestComplete = vi.fn();
      mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
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

      // First SSE event: not all pending issues seen yet, no close.
      fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
      // Second SSE event: all seen now, but still within MIN_LOADER_MS, so a
      // timer gets scheduled.
      fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
      // A third, redundant SSE delivery for the same issue re-invokes
      // maybeAutoClose while the timer is already scheduled — this must be
      // a no-op (the `if (minDelayTimerRef.current) return;` branch).
      fireSSE({ type: "run:created", runId: "run-b-retry", issueId: issueB.id });

      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledOnce();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a pending min-delay timer on unmount without throwing", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueA.id], skipped: [] });

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 1 run/i }));

    await waitFor(() => {
      expect(mockApi.ingestIssues).toHaveBeenCalled();
    });

    // Unmount while the MIN_LOADER_MS delay timer is still pending; this
    // exercises the cleanup effect's clearTimeout call.
    expect(() => unmount()).not.toThrow();
  });
});
