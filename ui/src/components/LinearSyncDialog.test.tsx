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
      <LinearSyncDialog open={false} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/No pending issues found/i)).toBeDefined();
    });
    // No Start button should render when there's nothing to ingest.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("shows an error message when the initial issue fetch fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Network down"));
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Network down")).toBeDefined();
    });
  });

  it("deselects all issues via the 'Select all' checkbox, disabling the Start button", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAll = screen.getByRole("checkbox", { name: /Select all/i });
    expect((selectAll as HTMLInputElement).checked).toBe(true);

    await user.click(selectAll);
    expect((selectAll as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: /start 0 run\b/i })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(selectAll);
    expect((selectAll as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggles a single issue's checkbox independently, updating the Start count", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const checkboxes = screen.getAllByRole("checkbox").filter((c) => c !== screen.getByRole("checkbox", { name: /Select all/i }));
    expect(checkboxes).toHaveLength(2);

    await user.click(checkboxes[0]);
    expect(screen.getByRole("button", { name: /start 1 run\b/i })).toBeDefined();

    await user.click(checkboxes[0]);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("re-fetches issues when the refresh button is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
  });

  it("renders issue project, priority label, and issue labels", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          ...issueA,
          project: "Backend",
          priority: 1,
          labels: ["bug", "urgent-fix"],
        },
      ],
    });
    render(<LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText("Backend")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
  });

  it("clicking Cancel calls onClose without starting any ingest", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    render(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    await user.click(screen.getByRole("button", { name: /cancel/i }));

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
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
