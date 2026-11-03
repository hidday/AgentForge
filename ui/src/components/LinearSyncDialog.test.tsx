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

  it("renders nothing when open is false", () => {
    const { container } = render(
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a loading state while fetching issues", () => {
    mockApi.fetchPendingIssues.mockReturnValue(new Promise(() => {}));
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    expect(screen.getByText(/Fetching issues from Linear/i)).toBeDefined();
  });

  it("shows an error state when fetchPendingIssues rejects", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
  });

  it("shows a generic error message when fetchPendingIssues rejects with a non-Error value", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("oops");
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Failed to fetch issues")).toBeDefined();
    });
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("No pending issues found")).toBeDefined();
    });
    // No footer Start button when there are no issues
    expect(screen.queryByRole("button", { name: /Start/i })).toBeNull();
  });

  it("renders issue details: id prefix, project, priority, and labels", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-xyz-123",
          title: "Labeled issue",
          description: "",
          state: "Todo",
          labels: ["backend", "urgent-fix"],
          priority: 1,
          project: "Core Platform",
        },
      ],
    });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Labeled issue")).toBeDefined());
    expect(screen.getByText("issue-xy")).toBeDefined();
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
  });

  it("falls back to priority 0 (None) styling when priority is unrecognized", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        { id: "i1", title: "T", description: "", state: "Todo", labels: [], priority: 99 },
      ],
    });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("None")).toBeDefined());
  });

  it("selects all issues by default and the Start button reflects the count", async () => {
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: "Start 2 Runs" })).toBeDefined();
    const selectAllCheckbox = screen.getByRole("checkbox", { name: /Select all/i });
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(true);
  });

  it("toggleAll deselects then reselects all issues, disabling Start when none are selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getByRole("checkbox", { name: /Select all/i });
    await user.click(selectAllCheckbox);
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: /Start/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(selectAllCheckbox);
    expect((selectAllCheckbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Start 2 Runs" })).toBeDefined();
  });

  it("toggling a single issue checkbox updates the selection and Start label (singular)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const issueBCheckbox = screen.getByRole("checkbox", { name: new RegExp(issueB.title) });
    await user.click(issueBCheckbox);

    expect(screen.getByRole("button", { name: "Start 1 Run" })).toBeDefined();

    // toggling it back on restores plural count
    await user.click(issueBCheckbox);
    expect(screen.getByRole("button", { name: "Start 2 Runs" })).toBeDefined();
  });

  it("clicking the refresh button re-fetches issues", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    await userEvent.click(backdrop, { pointerEventsCheck: 0 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does nothing when handleIngest is invoked with no issues selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("checkbox", { name: /Select all/i }));
    expect((screen.getByRole("button", { name: /Start/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("ignores SSE events that are not 'run:created'", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /Start 2 Runs/i }));

    fireSSE({ type: "run:updated", runId: "run-a" } as unknown as import("@/hooks/useSSE.ts").DashboardEvent);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores run:created SSE events for an issue id that was not part of the pending selection", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /Start 2 Runs/i }));

    fireSSE({ type: "run:created", runId: "run-z", issueId: "not-pending" });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a run:created SSE event missing an issueId", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /Start 2 Runs/i }));

    fireSSE({ type: "run:created", runId: "run-z" });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets ingest tracking state when the dialog is reopened", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const { rerender } = render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /Start 2 Runs/i }));
    expect(screen.getByRole("button", { name: /starting/i })).toBeDefined();

    // Close then reopen — ingesting flag should reset to false and issues
    // should be refetched.
    rerender(<LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />);
    rerender(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: "Start 2 Runs" })).toBeDefined();
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
});
