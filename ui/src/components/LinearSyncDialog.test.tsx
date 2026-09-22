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

  it("does not render anything when open is false", () => {
    const { container } = render(
      <LinearSyncDialog
        open={false}
        onClose={vi.fn()}
        onIngested={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows a loading indicator while issues are being fetched", async () => {
    let resolveFetch!: (v: { issues: typeof issueA[] }) => void;
    mockApi.fetchPendingIssues.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    expect(screen.getByText(/Fetching issues from Linear/i)).toBeDefined();

    await act(async () => {
      resolveFetch({ issues: [] });
    });

    await waitFor(() =>
      expect(screen.queryByText(/Fetching issues from Linear/i)).toBeNull(),
    );
  });

  it("shows an error state when the initial fetch fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Linear API down/i)).toBeDefined(),
    );
    // No issue list or start button should render in the error state.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText("No pending issues found")).toBeDefined(),
    );
    expect(
      screen.getByText(/All "Todo" issues already have active runs/i),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("refetches issues when the refresh button is clicked", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledOnce();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTitle("Refresh"));

    await waitFor(() =>
      expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2),
    );
  });

  it("toggles individual issues and select-all, disabling Start when none selected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    // both issues start selected
    expect(
      screen.getByRole("button", { name: /start 2 runs/i }),
    ).toBeDefined();

    const checkboxA = screen.getByRole("checkbox", {
      name: new RegExp(issueA.title),
    });
    await user.click(checkboxA);
    expect(
      screen.getByRole("button", { name: /start 1 run$/i }),
    ).toBeDefined();

    const checkboxB = screen.getByRole("checkbox", {
      name: new RegExp(issueB.title),
    });
    await user.click(checkboxB);
    const startBtn = screen.getByRole(
      "button",
      { name: /start 0 run$/i },
    ) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);

    // select-all checkbox re-selects everything
    const selectAll = screen.getByRole("checkbox", { name: /select all/i });
    await user.click(selectAll);
    expect(
      (screen.getByRole("button", { name: /start 2 runs/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // clicking select-all again clears the selection
    await user.click(selectAll);
    expect(
      (screen.getByRole("button", { name: /start 0 run$/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders issue metadata: id, project badge, priority label, and labels", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-c-12345678",
          title: "Issue with metadata",
          description: "",
          state: "Todo",
          labels: ["backend", "urgent-fix"],
          priority: 1,
          project: "Core Platform",
        },
      ],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText("Issue with metadata")).toBeDefined(),
    );
    expect(screen.getByText("issue-c-")).toBeDefined(); // id.slice(0, 8)
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
  });

  it("falls back to the 'None' priority label for an unrecognized priority value", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-d",
          title: "Unusual priority issue",
          description: "",
          state: "Todo",
          labels: [],
          priority: 99,
        },
      ],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText("Unusual priority issue")).toBeDefined(),
    );
    expect(screen.getByText("None")).toBeDefined();
  });

  it("calls onClose when the Cancel button or the backdrop is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    const { container } = render(
      <LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();

    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not call onIngested when handleIngest resolves with zero started runs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onIngested = vi.fn();
    const onIngestComplete = vi.fn();

    mockApi.ingestIssues.mockResolvedValue({
      ok: true,
      started: [],
      skipped: [issueA.id, issueB.id],
    });

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

    await waitFor(() =>
      expect(onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 2 }),
    );
    expect(onIngested).not.toHaveBeenCalled();
  });

  it("ignores SSE events for issues not part of the current pending batch", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    // ingestIssues never resolves — only SSE can trigger the close.
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // An SSE event of a different type, and one for an unrelated issue,
    // should both be no-ops.
    fireSSE({ type: "run:state-changed", runId: "run-x" } as unknown as DashboardEvent);
    fireSSE({ type: "run:created", runId: "run-z", issueId: "unrelated-issue" });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
