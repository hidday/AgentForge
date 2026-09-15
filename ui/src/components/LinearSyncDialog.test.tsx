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

  it("shows an error message and lets the user retry via Refresh when fetchPendingIssues rejects", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.fetchPendingIssues.mockRejectedValueOnce(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Linear API down/i)).toBeDefined();
    });

    // Fix the mock and retry via the header Refresh button.
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    await user.click(screen.getByTitle("Refresh"));

    await waitFor(() => {
      expect(screen.getByText(issueA.title)).toBeDefined();
    });
    expect(screen.queryByText(/Linear API down/i)).toBeNull();
  });

  it("shows the empty state when there are no pending issues", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("No pending issues found")).toBeDefined();
    });
    // No Start button should render when there are no issues to select.
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("toggling a single issue off updates the Start button count to the singular form", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    // Uncheck issue B specifically.
    const checkboxB = screen.getByText(issueB.title).closest("label")!.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await user.click(checkboxB);

    expect(screen.getByRole("button", { name: /^start 1 run$/i })).toBeDefined();
  });

  it("the header 'select all' checkbox deselects everything (disabling Start) and re-selects everything", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const selectAllCheckbox = screen.getByLabelText(/select all/i) as HTMLInputElement;
    expect(selectAllCheckbox.checked).toBe(true);

    await user.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(false);
    const startBtn = screen.getByRole("button", { name: /^start 0 run$/i }) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);

    await user.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(true);
    expect(
      (screen.getByRole("button", { name: /start 2 runs/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("renders the project badge and label chips when an issue has them, and does not call onIngested when nothing started", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const richIssue = {
      id: "issue-c",
      title: "Issue with metadata",
      description: "",
      state: "Todo",
      labels: ["bug", "urgent-fix"],
      priority: 1,
      project: "Core Platform",
    };
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [richIssue] });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [richIssue.id] });
    const onIngested = vi.fn();

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={onIngested} />,
    );

    await waitFor(() => expect(screen.getByText(richIssue.title)).toBeDefined());
    expect(screen.getByText("Core Platform")).toBeDefined();
    expect(screen.getByText("bug")).toBeDefined();
    expect(screen.getByText("urgent-fix")).toBeDefined();
    expect(screen.getByText("Urgent")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /start 1 run/i }));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(mockApi.ingestIssues).toHaveBeenCalled();
    });
    expect(onIngested).not.toHaveBeenCalled();
  });

  it.each([
    [0, "None"],
    [1, "Urgent"],
    [3, "Medium"],
    [4, "Low"],
    [99, "None"],
  ])("renders the correct priority label for priority %s", async (priority, label) => {
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ ...issueA, priority }],
    });

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());
    expect(screen.getByText(label)).toBeDefined();
  });
});
