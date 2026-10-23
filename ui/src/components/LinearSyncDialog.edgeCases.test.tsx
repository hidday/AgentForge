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
  labels: ["backend", "urgent"],
  priority: 1,
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

describe("LinearSyncDialog edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an error when fetching pending issues fails", async () => {
    mockApi.fetchPendingIssues.mockRejectedValue(new Error("Linear API down"));

    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Linear API down")).toBeDefined();
    });
    expect(screen.queryByText(issueA.title)).toBeNull();
  });

  it("renders label chips for an issue that has labels", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByText("backend")).toBeDefined();
    expect(screen.getByText("urgent")).toBeDefined();
  });

  it("toggleAll deselects then reselects every issue", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();

    const selectAllCheckbox = screen.getByRole("checkbox", {
      name: /select all/i,
    }) as HTMLInputElement;
    expect(selectAllCheckbox.checked).toBe(true);

    await userEvent.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: /start \d+ runs?/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await userEvent.click(selectAllCheckbox);
    expect(selectAllCheckbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("toggleOne deselects then reselects a single issue", async () => {
    render(
      <LinearSyncDialog open={true} onClose={vi.fn()} onIngested={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // First checkbox is "select all"; the rest are per-issue.
    const issueCheckbox = checkboxes[1]!;
    expect(issueCheckbox.checked).toBe(true);

    await userEvent.click(issueCheckbox);
    expect(issueCheckbox.checked).toBe(false);
    expect(screen.getByRole("button", { name: /start 1 run/i })).toBeDefined();

    // The "select all" checkbox should now read as unchecked (partial selection).
    const selectAllCheckbox = checkboxes[0]!;
    expect(selectAllCheckbox.checked).toBe(false);

    await userEvent.click(issueCheckbox);
    expect(issueCheckbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /start 2 runs/i })).toBeDefined();
  });

  it("clears a pending min-loader timer when the dialog is closed and reopened mid-ingest", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();

    // Never resolves — the only way to reach maybeAutoClose is via SSE.
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(
      <LinearSyncDialog
        open={true}
        onClose={onClose}
        onIngested={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(issueA.title)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /start 2 runs/i }));

    // Both pending ids observed quickly (well inside MIN_LOADER_MS), so
    // maybeAutoClose schedules a delayed timer instead of closing right away.
    fireSSE({ type: "run:created", runId: "run-a", issueId: issueA.id });
    fireSSE({ type: "run:created", runId: "run-b", issueId: issueB.id });
    expect(onClose).not.toHaveBeenCalled();

    // Close and reopen before the scheduled timer fires — this re-runs the
    // open-effect, which must clear the stale timer.
    rerender(<LinearSyncDialog open={false} onClose={onClose} onIngested={vi.fn()} />);
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [issueA, issueB] });
    rerender(<LinearSyncDialog open={true} onClose={onClose} onIngested={vi.fn()} />);

    await waitFor(() => expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2));

    // Advance well past the original window — the stale timer must not have
    // survived to fire a close.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires onIngestComplete a second time from handleIngest when ingestIssues settles after the min-loader window has already elapsed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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

    // Let the min-loader window elapse BEFORE the ingest request settles, so
    // when it resolves, maybeAutoClose closes synchronously inside the
    // try-block and handleIngest's own post-check also fires onIngestComplete.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveIngest({ ok: true, started: [issueA.id, issueB.id], skipped: [] });
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(onIngested).toHaveBeenCalledOnce();
    // Called twice with the same authoritative summary: once from
    // maybeAutoClose, once from handleIngest's trailing check.
    expect(onIngestComplete).toHaveBeenCalledTimes(2);
    expect(onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });
    expect(onIngestComplete).toHaveBeenNthCalledWith(2, { started: 2, skipped: 0 });
  });
});
