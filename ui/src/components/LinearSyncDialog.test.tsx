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

const issueWithMetadata = {
  id: "issue-c",
  title: "Issue with project and labels",
  description: "",
  state: "Todo",
  project: "Foundry",
  labels: ["bug", "urgent"],
  priority: 1,
};

const issueUnknownPriority = {
  id: "issue-d",
  title: "Issue with unmapped priority",
  description: "",
  state: "Todo",
  labels: [],
  priority: 99,
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
    expect(container.innerHTML).toBe("");
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows a loading indicator while fetching issues", async () => {
    let resolveFetch: (v: { issues: typeof issueA[] }) => void = () => {};
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
      expect(screen.getByText(/no pending issues found/i)).toBeDefined();
    });
  });

  it("shows an empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/no pending issues found/i)).toBeDefined();
    });
    // No Start button should render when there are no issues to sync.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("shows an error state when fetching issues fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/linear api down/i)).toBeDefined();
    });
  });

  it("falls back to a generic error message when a non-Error is thrown while fetching", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue("some string failure");

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/failed to fetch issues/i)).toBeDefined();
    });
  });

  it("re-fetches issues when the refresh button is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTitle(/refresh/i));

    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));
  });

  it("renders project, priority, and label metadata, using the unmapped-priority fallback when needed", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [issueWithMetadata, issueUnknownPriority],
    });

    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueWithMetadata.title)).toBeDefined());

    expect(screen.getByText("Foundry")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
    // priority 99 has no entry in PRIORITY_LABELS, so it falls back to the
    // "None" (priority 0) label instead of rendering nothing.
    expect(screen.getByText(issueUnknownPriority.title)).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
  });

  it("toggles individual issue selection and the select-all checkbox", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // Both issues are selected by default.
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const checkboxA = screen.getByRole("checkbox", { name: new RegExp(issueA.title) });
    await user.click(checkboxA);
    expect(screen.getByRole("button", { name: /start 1 run$/i })).toBeDefined();

    await user.click(checkboxA);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAll = screen.getByRole("checkbox", { name: /select all/i });
    await user.click(selectAll);
    expect(screen.getByRole("button", { name: /start 0 run$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /start 0 run$/i })).toHaveProperty("disabled", true);

    await user.click(selectAll);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("does not submit an ingest when no issues are selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAll = screen.getByRole("checkbox", { name: /select all/i });
    await user.click(selectAll);

    const startBtn = screen.getByRole("button", { name: /start 0 run$/i });
    await user.click(startBtn);

    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("calls onClose when the Cancel button or the backdrop is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const { container } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events that aren't run:created and events for issues outside the pending set", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const startBtn = screen.getByRole("button", { name: /start 2 runs/i });
    await user.click(startBtn);

    // Wrong event type: ignored.
    fireSSE({ type: "run:updated", runId: "run-a" } as unknown as DashboardEvent);
    // run:created for an issue we never selected: ignored.
    fireSSE({ type: "run:created", runId: "run-x", issueId: "some-other-issue" });
    // run:created with no issueId at all: ignored.
    fireSSE({ type: "run:created", runId: "run-y" } as unknown as DashboardEvent);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // None of the above should have satisfied the "every selected issue
    // seen" condition, so the dialog must still be open.
    expect(onClose).not.toHaveBeenCalled();
  });
});
