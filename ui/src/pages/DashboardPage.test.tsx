import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: ({
    open,
    onClose,
    onIngestComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    open ? (
      <div data-testid="sync-dialog">
        Sync Dialog
        <button onClick={() => onIngestComplete({ started: 2, skipped: 1 })}>
          Simulate Ingest
        </button>
        <button onClick={onClose}>Close Sync Dialog</button>
      </div>
    ) : null,
}));

import { api } from "@/api/client.ts";
import { DashboardPage } from "./DashboardPage.tsx";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

const activeRun = { id: "r1", state: "Implementing", repo: "org/repo", updatedAt: "2024-01-01T00:00:00Z", linearIssueId: "i1", linearIssueIdentifier: "ENG-1", linearIssueTitle: "A", linearIssueUrl: null, prNumber: null };
const doneRun = { id: "r2", state: "Done", repo: "org/repo", updatedAt: "2024-01-01T00:00:00Z", linearIssueId: "i2", linearIssueIdentifier: "ENG-2", linearIssueTitle: "B", linearIssueUrl: null, prNumber: null };

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("shows a loading indicator, then the runs table once runs load", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [activeRun, doneRun] });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeDefined();

    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("B")).toBeDefined();
  });

  it("shows an error message when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("Server down"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Server down")).toBeDefined());
  });

  it("computes per-category stat counts from the loaded runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [activeRun, doneRun] });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());

    const activeStatLabel = screen
      .getAllByText("Active")
      .find((el) => el.tagName !== "BUTTON")!;
    const doneStatLabel = screen.getAllByText("Done").find((el) => el.tagName !== "BUTTON")!;

    expect(screen.getByText("Total").previousSibling?.textContent).toBe("2");
    expect(activeStatLabel.previousSibling?.textContent).toBe("1");
    expect(doneStatLabel.previousSibling?.textContent).toBe("1");
  });

  it("buckets a run with an unmapped state under 'idle' in the stat counts", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [{ ...activeRun, id: "r3", state: "SomeUnmappedState" }],
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());

    expect(screen.getByText("Total").previousSibling?.textContent).toBe("1");
    const activeStatLabel = screen
      .getAllByText("Active")
      .find((el) => el.tagName !== "BUTTON")!;
    expect(activeStatLabel.previousSibling?.textContent).toBe("0");
  });

  it("filters the visible runs when a filter chip is clicked", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [activeRun, doneRun] });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.getByText("B")).toBeDefined();
  });

  it("opens the sync dialog when 'Sync from Linear' is clicked", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/ }));
    expect(screen.getByTestId("sync-dialog")).toBeDefined();
  });

  it("closes the sync dialog when its onClose fires", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/ }));
    await userEvent.click(screen.getByRole("button", { name: "Close Sync Dialog" }));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("dismisses the ingest summary banner when its dismiss button is clicked", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/ }));
    await userEvent.click(screen.getByRole("button", { name: "Simulate Ingest" }));
    expect(screen.getByRole("status")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refetches the run list when an SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [activeRun] });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading runs...")).toBeNull());

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [activeRun, doneRun] });
    await act(async () => {
      sseCallback!({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(screen.getByText("B")).toBeDefined());
  });
});

describe("DashboardPage ingest summary banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the ingest summary banner after a sync completes, then auto-dismisses it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await user.click(screen.getByRole("button", { name: /Sync from Linear/ }));
    await user.click(screen.getByRole("button", { name: "Simulate Ingest" }));

    expect(screen.getByRole("status").textContent).toContain("Started 2 runs");
    expect(screen.getByRole("status").textContent).toContain("skipped 1");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });
});
