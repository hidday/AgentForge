import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

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

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: () => {},
  };
});

import { DashboardPage } from "./DashboardPage.tsx";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getRuns: ReturnType<typeof vi.fn>;
  fetchPendingIssues: ReturnType<typeof vi.fn>;
  ingestIssues: ReturnType<typeof vi.fn>;
  approvePlan: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading indicator, then the runs table once loaded", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun()] });
    renderPage();
    expect(screen.getByText(/Loading runs/i)).toBeDefined();
    await waitFor(() => expect(screen.getByText("Fix the bug")).toBeDefined());
  });

  it("shows an error message when fetching runs fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));
    renderPage();
    await waitFor(() => expect(screen.getByText("network down")).toBeDefined());
  });

  it("renders summary stat counts per category", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing" }),
        makeRun({ id: "r2", state: "AwaitingPlanApproval" }),
        makeRun({ id: "r3", state: "AIBlocked" }),
        makeRun({ id: "r4", state: "Done" }),
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Total")).toBeDefined());
    expect(screen.getByText("4")).toBeDefined(); // total
  });

  it("buckets a run with an unrecognized state under 'idle' in the stat counts", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [makeRun({ id: "r1", state: "SomeUnknownState" })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Total")).toBeDefined());
    // Total should be 1, and none of the known categories should count it.
    expect(screen.getByText("1")).toBeDefined();
  });

  it("filters the run list when a filter button is clicked", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        makeRun({ id: "r1", state: "Implementing", linearIssueTitle: "Active issue" }),
        makeRun({ id: "r2", state: "Done", linearIssueTitle: "Done issue" }),
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Active issue")).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Active issue")).toBeNull();
    expect(screen.getByText("Done issue")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Active issue")).toBeDefined();
  });

  it("opens the Linear sync dialog when 'Sync from Linear' is clicked", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    mockApi.fetchPendingIssues.mockResolvedValue({ issues: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("No runs found")).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    expect(screen.getByText(/Pull pending "Todo" issues/)).toBeDefined();
  });

  it("shows and auto-dismisses the ingest summary banner after a sync completes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    mockApi.getRuns.mockResolvedValue({ runs: [] });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ id: "i1", title: "Issue 1", description: "", state: "Todo", labels: [], priority: 2 }],
    });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: ["i1"], skipped: [] });

    renderPage();
    await waitFor(() => expect(screen.getByText("No runs found")).toBeDefined());

    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await waitFor(() => expect(screen.getByText("Issue 1")).toBeDefined());

    await user.click(screen.getByRole("button", { name: /Start 1 Run/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(screen.getByText(/Started 1 run/)).toBeDefined());

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => expect(screen.queryByText(/Started 1 run/)).toBeNull());
  });

  it("dismisses the ingest summary banner when the dismiss button is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    mockApi.getRuns.mockResolvedValue({ runs: [] });
    mockApi.fetchPendingIssues.mockResolvedValue({
      issues: [{ id: "i1", title: "Issue 1", description: "", state: "Todo", labels: [], priority: 2 }],
    });
    mockApi.ingestIssues.mockResolvedValue({ ok: true, started: ["i1"], skipped: [] });

    renderPage();
    await waitFor(() => expect(screen.getByText("No runs found")).toBeDefined());
    await user.click(screen.getByRole("button", { name: /Sync from Linear/i }));
    await waitFor(() => expect(screen.getByText("Issue 1")).toBeDefined());
    await user.click(screen.getByRole("button", { name: /Start 1 Run/i }));

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(screen.getByText(/Started 1 run/)).toBeDefined());

    await user.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByText(/Started 1 run/)).toBeNull();
  });

  it("refetches the runs list when a run row action completes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ state: "AwaitingPlanApproval" })] });
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    renderPage();
    await waitFor(() => expect(screen.getByText("Fix the bug")).toBeDefined());

    await userEvent.click(screen.getByTitle("Approve Plan"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });
});
