import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestSSEHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix bug",
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
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state and populates runs on successful fetch", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Planning"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("sets an error message when the fetch fails with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRuns.mockRejectedValue("boom");

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes api.getRuns and clears a prior error", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    const runs = [makeRun({ id: "run-2" })];
    mockApi.getRuns.mockResolvedValueOnce({ runs });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toEqual(runs);
  });

  it("refetches all runs on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    const newRuns = [makeRun({ id: "run-created" })];
    mockApi.getRuns.mockResolvedValue({ runs: newRuns });

    await act(async () => {
      latestSSEHandler()({ type: "run:created", runId: "run-created" });
    });

    await waitFor(() => expect(result.current.runs).toEqual(newRuns));
  });

  it("updates a run's state in place on a run:state-changed event without refetching", async () => {
    const runs = [makeRun({ id: "run-1", state: "Todo" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    mockApi.getRuns.mockClear();

    act(() => {
      latestSSEHandler()({ type: "run:state-changed", runId: "run-1", to: "Planning" });
    });

    expect(result.current.runs[0]!.state).toBe("Planning");
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("leaves other runs untouched when a run:state-changed event targets a different run id", async () => {
    const runs = [makeRun({ id: "run-1", state: "Todo" }), makeRun({ id: "run-2", state: "Todo" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    act(() => {
      latestSSEHandler()({ type: "run:state-changed", runId: "run-2", to: "Done" });
    });

    expect(result.current.runs.find((r) => r.id === "run-1")!.state).toBe("Todo");
    expect(result.current.runs.find((r) => r.id === "run-2")!.state).toBe("Done");
  });

  it("ignores unrelated SSE event types", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    mockApi.getRuns.mockClear();
    act(() => {
      latestSSEHandler()({ type: "process:started", runId: "run-1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual(runs);
  });
});
