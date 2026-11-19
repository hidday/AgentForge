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
  priority: 2,
  project: "Core",
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

describe("LinearSyncDialog - additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an error and allows retry when fetchPendingIssues rejects", async () => {
    mockApi.fetchPendingIssues.mockRejectedValueOnce(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(/Linear API down/i)).toBeDefined());

    // Retry via the refresh button, this time succeeding.
    mockApi.fetchPendingIssues.mockResolvedValueOnce({ issues: [issueA, issueB] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTitle("Refresh"));

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.queryByText(/Linear API down/i)).toBeNull();
  });

  it("renders the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(/No pending issues found/i)).toBeDefined(),
    );
    // No Start button when there is nothing to ingest.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("renders issue project and label chips", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("Core")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
  });

  it("toggleAll deselects every issue, then re-selecting via the checkbox restores them", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAll = screen.getByLabelText(/Select all/i);
    await user.click(selectAll); // deselect all
    expect(screen.getByRole("button", { name: /start 0 run/i })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(selectAll); // re-select all
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggleOne deselects a single issue so only the remaining one is ingested", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [issueB.id], skipped: [] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByText(issueA.title));
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    await user.click(screen.getByRole("button", { name: /start 1 run\b/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(mockApi.ingestIssues).toHaveBeenCalledWith([issueB.id]));
  });

  it("ignores SSE events without a matching issueId", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // No issueId at all.
    fireSSE({ type: "run:created", runId: "run-x" });
    // issueId not among the pending ones.
    fireSSE({ type: "run:created", runId: "run-y", issueId: "unrelated-issue" });
    // Wrong event type entirely.
    fireSSE({ type: "run:state-changed", runId: "run-z" });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onIngested when the ingest response starts nothing, even though it still auto-closes", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [issueA.id, issueB.id] });
    const onIngested = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={onIngested} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("fires a second onIngestComplete with authoritative counts when the HTTP response settles after SSE already auto-closed", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    const onIngestComplete = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

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
        onIngested={vi.fn()}
        onIngestComplete={onIngestComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE observes both issues and, after the min-loader delay, auto-closes
    // before the HTTP request has settled.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });

    // Now the HTTP response lands with the authoritative counts.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(onIngestComplete).toHaveBeenLastCalledWith({ started: 1, skipped: 1 }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears the pending min-delay timer on unmount without throwing", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const { unmount } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Issue is observed quickly, scheduling the min-delay follow-up timer
    // (elapsed < MIN_LOADER_MS), then the component unmounts before it fires.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    expect(() => unmount()).not.toThrow();
  });
});
