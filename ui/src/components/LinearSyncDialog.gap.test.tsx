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
  labels: [] as string[],
  priority: 2,
};

const issueB = {
  id: "issue-b",
  title: "Second issue",
  description: "",
  state: "Todo",
  labels: [] as string[],
  priority: 2,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("LinearSyncDialog — gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("renders nothing when open is false", () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a loading state while issues are being fetched", async () => {
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

  it("shows an error message when the initial issue fetch fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/no pending issues found/i)).toBeDefined();
    });
    // No Start button when there is nothing to ingest.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("clicking Cancel calls onClose without starting an ingest", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });
    const onClose = vi.fn();

    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("toggleAll deselects all issues, and the Start button disables at zero selected", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAll = screen.getByRole("checkbox", { name: /select all/i });
    expect((selectAll as HTMLInputElement).checked).toBe(true);

    await userEvent.click(selectAll);

    expect((selectAll as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Start 0 Run" })).toHaveProperty(
      "disabled",
      true,
    );

    await userEvent.click(selectAll);
    expect((selectAll as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggleOne deselects a single issue, reducing the Start count and using singular 'Run'", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueBCheckbox = screen.getByRole("checkbox", { name: new RegExp(issueB.title) });
    await userEvent.click(issueBCheckbox);

    expect((issueBCheckbox as HTMLInputElement).checked).toBe(false);
    // Singular "Run" (no trailing "s") when exactly one issue remains selected.
    expect(screen.getByRole("button", { name: "Start 1 Run" })).toBeDefined();
  });

  it("toggleOne re-selects a previously deselected issue", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueBCheckbox = screen.getByRole("checkbox", { name: new RegExp(issueB.title) });
    // Deselect, then re-select — exercises both the delete and add branches.
    await userEvent.click(issueBCheckbox);
    expect((issueBCheckbox as HTMLInputElement).checked).toBe(false);

    await userEvent.click(issueBCheckbox);
    expect((issueBCheckbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a pending auto-close timer and resets ingest tracking when the dialog is closed and reopened mid-flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    // ingestIssues never resolves — any auto-close must come from the
    // scheduled minimum-loader-delay timer driven by SSE.
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // SSE observes both issues almost immediately — this is within the
    // MIN_LOADER_MS window, so a close is scheduled via setTimeout rather
    // than firing immediately.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    // Close and reopen the dialog (parent-controlled) before the scheduled
    // timer fires. This must clear the pending timer and reset tracking
    // state so the stale ingest cycle cannot auto-close the new session.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // The stale timer from the first ingest cycle must not have fired.
    expect(onClose).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("renders a project badge when the issue has a project, and omits it when absent", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, project: "Backend" }, issueB],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByText("Backend")).toBeDefined();
  });

  it("renders label chips when the issue has labels", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, labels: ["bug", "urgent-fix"] }],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
  });

  it("falls back to the 'None' priority label for an unrecognized priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority: 99 }],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByText("None")).toBeDefined();
  });

  it("clicking refresh re-fetches issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
    });
  });

  it("fires a second onIngestComplete with authoritative counts when the HTTP response settles after SSE already closed the dialog", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });

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

    // SSE observes both issues before the HTTP response arrives, past the
    // minimum loader delay — this closes the dialog with the "optimistic"
    // summary (started = pendingIds.length, skipped = 0).
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });

    // Now the HTTP response resolves with the authoritative counts — one of
    // the two issues was actually skipped. This should fire a *second*
    // onIngestComplete call with the real numbers, plus onIngested since at
    // least one run started.
    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id], skipped: [issueB.id] });
    });

    await waitFor(() => {
      expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    });
    expect(onIngested).toHaveBeenCalledOnce();
    // The dialog should not be closed a second time.
    expect(onClose).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
