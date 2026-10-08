// Supplementary LinearSyncDialog coverage: issue listing/selection, fetch
// failures, SSE filtering, timer edge cases and the authoritative follow-up
// summary. The core auto-close flows live in LinearSyncDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { LinearSyncDialog } from "./LinearSyncDialog.tsx";
import type { DashboardEvent } from "@/hooks/useSSE.ts";
import type { LinearIssue } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: { fetchPendingIssues: vi.fn(), ingestIssues: vi.fn() },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  fetchPendingIssues: ReturnType<typeof vi.fn>;
  ingestIssues: ReturnType<typeof vi.fn>;
};

function issue(id: string, overrides: Partial<LinearIssue> = {}): LinearIssue {
  return { id, title: `Issue ${id}`, description: "", state: "Todo", labels: [], priority: 0, ...overrides };
}

const A = issue("aaaaaaaa-1111", { priority: 1, project: "Core", labels: ["bug", "ui"] });
const B = issue("bbbbbbbb-2222", { priority: 9 });

function fireSSE(event: DashboardEvent) {
  act(() => sseCallback!(event));
}

function props(overrides: Partial<React.ComponentProps<typeof LinearSyncDialog>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onIngested: vi.fn(),
    onIngestComplete: vi.fn(),
    ...overrides,
  };
}

function checkbox(name: RegExp | string) {
  return screen.getByRole("checkbox", { name }) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  sseCallback = null;
  mockApi.fetchPendingIssues.mockResolvedValue({ issues: [A, B] });
});

describe("LinearSyncDialog listing and selection", () => {
  it("renders nothing and does not fetch when closed", () => {
    const { container } = render(<LinearSyncDialog {...props({ open: false })} />);
    expect(container.innerHTML).toBe("");
    expect(mockApi.fetchPendingIssues).not.toHaveBeenCalled();
  });

  it("shows a loading state, then issue details with priority, project and labels", async () => {
    render(<LinearSyncDialog {...props()} />);
    expect(screen.getByText("Fetching issues from Linear...")).toBeTruthy();
    await screen.findByText("Issue aaaaaaaa-1111");
    expect(screen.getByText("aaaaaaaa")).toBeTruthy();
    expect(screen.getByText("Core")).toBeTruthy();
    expect(screen.getByText("Urgent").className).toContain("text-state-blocked");
    expect(screen.getByText("bug")).toBeTruthy();
    expect(screen.getByText("ui")).toBeTruthy();
    // unknown priority falls back to "None"
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("Select all (2)")).toBeTruthy();
  });

  it("selects everything by default and toggles all / individual issues", async () => {
    render(<LinearSyncDialog {...props()} />);
    await screen.findByText("Issue aaaaaaaa-1111");
    const all = checkbox(/Select all/);
    expect(all.checked).toBe(true);
    expect(screen.getByRole("button", { name: "Start 2 Runs" })).toBeTruthy();

    fireEvent.click(all);
    expect(all.checked).toBe(false);
    const start0 = screen.getByRole("button", { name: "Start 0 Run" }) as HTMLButtonElement;
    expect(start0.disabled).toBe(true);

    fireEvent.click(checkbox(/Issue aaaaaaaa-1111/));
    expect(checkbox(/Issue aaaaaaaa-1111/).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Start 1 Run" })).toBeTruthy();
    expect(all.checked).toBe(false);

    fireEvent.click(checkbox(/Issue aaaaaaaa-1111/));
    expect(checkbox(/Issue aaaaaaaa-1111/).checked).toBe(false);

    fireEvent.click(all);
    expect(all.checked).toBe(true);
    expect(checkbox(/Issue bbbbbbbb-2222/).checked).toBe(true);
  });

  it("does not call ingest when nothing is selected", async () => {
    render(<LinearSyncDialog {...props()} />);
    await screen.findByText("Issue aaaaaaaa-1111");
    fireEvent.click(checkbox(/Select all/));
    // disabled buttons swallow clicks, so invoke the handler path directly
    fireEvent.click(screen.getByRole("button", { name: "Start 0 Run" }));
    expect(mockApi.ingestIssues).not.toHaveBeenCalled();
  });

  it("shows an empty state with no Start button", async () => {
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    render(<LinearSyncDialog {...props()} />);
    expect(await screen.findByText("No pending issues found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
  });

  it("surfaces fetch errors (Error and non-Error) and recovers on refresh", async () => {
    mockApi.fetchPendingIssues
      .mockRejectedValueOnce(new Error("Linear unauthorized"))
      .mockRejectedValueOnce("weird")
      .mockResolvedValueOnce({ issues: [A] });
    render(<LinearSyncDialog {...props()} />);
    expect(await screen.findByText("Linear unauthorized")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(await screen.findByText("Failed to fetch issues")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(await screen.findByText("Issue aaaaaaaa-1111")).toBeTruthy();
    expect(screen.queryByText("Failed to fetch issues")).toBeNull();
  });

  it("closes via Cancel and via backdrop", async () => {
    const p = props();
    const { container } = render(<LinearSyncDialog {...p} />);
    await screen.findByText("Issue aaaaaaaa-1111");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(container.querySelector(".backdrop-blur-sm")!);
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});

describe("LinearSyncDialog ingest edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function startWith(p: ReturnType<typeof props>) {
    render(<LinearSyncDialog {...p} />);
    await screen.findByText("Issue aaaaaaaa-1111");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start 2 Runs" }));
    });
  }

  it("ignores SSE events of other types, without issueId, or for unselected issues", async () => {
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const p = props();
    await startWith(p);
    fireSSE({ type: "run:state-changed", runId: "x", issueId: A.id });
    fireSSE({ type: "run:created", runId: "x" });
    fireSSE({ type: "run:created", runId: "x", issueId: "not-pending" });
    fireSSE({ type: "run:created", runId: "x", issueId: A.id });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    // B was never seen and HTTP never settled -> still open
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Starting/ })).toBeTruthy();
  });

  it("closes optimistically from SSE then reports authoritative counts when HTTP resolves", async () => {
    let resolve!: (v: unknown) => void;
    mockApi.ingestIssues.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = props();
    await startWith(p);
    expect(mockApi.ingestIssues).toHaveBeenCalledWith([A.id, B.id]);

    fireSSE({ type: "run:created", runId: "1", issueId: A.id });
    fireSSE({ type: "run:created", runId: "2", issueId: B.id });
    // second evaluation within the window must not schedule another close
    fireSSE({ type: "run:created", runId: "2", issueId: B.id });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onIngestComplete).toHaveBeenNthCalledWith(1, { started: 2, skipped: 0 });

    // late SSE after close is a no-op
    fireSSE({ type: "run:created", runId: "1", issueId: A.id });
    expect(p.onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ ok: true, started: [A.id], skipped: [B.id] });
    });
    expect(p.onIngested).toHaveBeenCalledTimes(1);
    expect(p.onIngestComplete).toHaveBeenNthCalledWith(2, { started: 1, skipped: 1 });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onIngested when nothing was started", async () => {
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [], skipped: [A.id, B.id] });
    const p = props();
    await startWith(p);
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onIngestComplete).toHaveBeenCalledWith({ started: 0, skipped: 2 });
    expect(p.onIngested).not.toHaveBeenCalled();
  });

  it("works without an onIngestComplete callback", async () => {
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: [A.id], skipped: [] });
    const p = props({ onIngestComplete: undefined });
    await startWith(p);
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onIngested).toHaveBeenCalledTimes(1);
  });

  it("uses a generic message for non-Error ingest failures and re-enables Start", async () => {
    mockApi.ingestIssues.mockRejectedValue({ status: 500 });
    const p = props();
    await startWith(p);
    expect(await screen.findByText("Failed to ingest issues")).toBeTruthy();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("clears a pending close timer when the dialog is reopened", async () => {
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const p = props();
    const { rerender } = render(<LinearSyncDialog {...p} />);
    await screen.findByText("Issue aaaaaaaa-1111");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start 2 Runs" }));
    });
    fireSSE({ type: "run:created", runId: "1", issueId: A.id });
    fireSSE({ type: "run:created", runId: "2", issueId: B.id });
    // timer scheduled; close & reopen before it fires
    rerender(<LinearSyncDialog {...p} open={false} />);
    rerender(<LinearSyncDialog {...p} open={true} />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onIngestComplete).not.toHaveBeenCalled();
    expect(mockApi.fetchPendingIssues).toHaveBeenCalledTimes(2);
  });

  it("clears a pending close timer on unmount", async () => {
    mockApi.ingestIssues.mockReturnValue(new Promise(() => {}));
    const p = props();
    const { unmount } = render(<LinearSyncDialog {...p} />);
    await screen.findByText("Issue aaaaaaaa-1111");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start 2 Runs" }));
    });
    fireSSE({ type: "run:created", runId: "1", issueId: A.id });
    fireSSE({ type: "run:created", runId: "2", issueId: B.id });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(p.onClose).not.toHaveBeenCalled();
  });
});

describe("LinearSyncDialog waiting for issues", () => {
  it("closes immediately (no extra delay) when HTTP settles after the min loader window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let resolve!: (v: unknown) => void;
      mockApi.ingestIssues.mockReturnValue(new Promise((r) => (resolve = r)));
      const p = props();
      render(<LinearSyncDialog {...p} />);
      await screen.findByText("Issue aaaaaaaa-1111");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Start 2 Runs" }));
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      await act(async () => {
        resolve({ ok: true, started: [A.id, B.id], skipped: [] });
      });
      await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
      expect(p.onIngestComplete).toHaveBeenCalledWith({ started: 2, skipped: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
