import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
    fetchPendingIssues: vi.fn(),
    ingestIssues: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

// DashboardPage has multiple useSSE consumers (useRuns + the nested
// LinearSyncDialog). Each consumer's callback is referentially stable across
// re-renders (memoized via useCallback), so a Set naturally dedupes re-render
// re-registrations while still capturing every distinct consumer.
let sseCallbacks = new Set<(event: DashboardEvent) => void>();
vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallbacks.add(cb);
    },
  };
});
function broadcastSSE(event: DashboardEvent) {
  for (const cb of sseCallbacks) cb(event);
}

import { DashboardPage } from "./DashboardPage.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getRuns: ReturnType<typeof vi.fn>;
  fetchPendingIssues: ReturnType<typeof vi.fn>;
  ingestIssues: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Some issue",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

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
    sseCallbacks = new Set();
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
  });

  it("shows a loading state before runs resolve", async () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
  });

  it("shows an error message when fetching runs fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("Failed to load"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Failed to load")).toBeDefined();
    });
  });

  it("renders the empty runs table state once loaded", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("No runs found")).toBeDefined();
    });
    const total = screen.getByText("Total").previousElementSibling as HTMLElement;
    expect(total.textContent).toBe("0");
  });

  it("renders stat counts and populated rows for a mix of run states", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active one" }),
        makeRun({ id: "r2", state: "AwaitingPlanApproval", linearIssueTitle: "Waiting one" }),
        makeRun({ id: "r3", state: "AIBlocked", linearIssueTitle: "Blocked one" }),
        makeRun({ id: "r4", state: "Done", linearIssueTitle: "Done one" }),
      ],
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Active one")).toBeDefined();
    });
    expect(screen.getByText("Waiting one")).toBeDefined();
    expect(screen.getByText("Blocked one")).toBeDefined();
    expect(screen.getByText("Done one")).toBeDefined();

    // Total stat should read 4
    const total = screen.getByText("Total").previousElementSibling as HTMLElement;
    expect(total.textContent).toBe("4");
  });

  it("counts a run with an unrecognized state toward Total without crashing or bumping a named stat", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        makeRun({ id: "r1", state: "SomeFutureState", linearIssueTitle: "Mystery run" }),
        makeRun({ id: "r2", state: "Implementing", linearIssueTitle: "Active one" }),
      ],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Mystery run")).toBeDefined());

    const total = screen.getByText("Total").previousElementSibling as HTMLElement;
    expect(total.textContent).toBe("2");
    // "Active" also labels a filter button, so scope to the stat's <div> label.
    const activeStatLabel = screen
      .getAllByText("Active")
      .find((el) => el.tagName === "DIV")!;
    const active = activeStatLabel.previousElementSibling as HTMLElement;
    expect(active.textContent).toBe("1");
  });

  it("filters runs by category when a filter button is clicked", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active one" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done one" }),
      ],
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Active one")).toBeDefined();
    });
    expect(screen.getByText("Done one")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Active" }));

    expect(screen.getByText("Active one")).toBeDefined();
    expect(screen.queryByText("Done one")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Done one")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("No runs found")).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByRole("heading", { name: "Sync from Linear" })).toBeDefined();
  });

  it("shows the ingest summary banner after a successful ingest and it can be dismissed", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-a",
          title: "Issue A",
          description: "",
          state: "Todo",
          labels: [],
          priority: 2,
        },
      ],
    });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: ["issue-a"], skipped: [] });

    renderPage();
    await waitFor(() => expect(screen.getByText("No runs found")).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await waitFor(() => expect(screen.getByText("Issue A")).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /start 1 run/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Started 1 run");
    });

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("auto-dismisses the ingest summary banner after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    mockApi.getRuns.mockResolvedValue({ runs: [] });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [
        {
          id: "issue-a",
          title: "Issue A",
          description: "",
          state: "Todo",
          labels: [],
          priority: 2,
        },
      ],
    });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: ["issue-a"], skipped: [] });

    renderPage();
    await waitFor(() => expect(screen.getByText("No runs found")).toBeDefined());

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await waitFor(() => expect(screen.getByText("Issue A")).toBeDefined());
    await user.click(screen.getByRole("button", { name: /start 1 run/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(screen.getByRole("status")).toBeDefined());

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    vi.useRealTimers();
  });

  it("refetches runs when the sync dialog reports an ingested run via SSE", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("No runs found")).toBeDefined());
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    act(() => {
      broadcastSSE({ type: "run:created", runId: "new-run" } as DashboardEvent);
    });

    await waitFor(() => {
      expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
    });
  });
});
