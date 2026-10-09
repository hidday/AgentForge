import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns";
import type { DashboardEvent } from "./useSSE";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

const runA = {
  id: "run-a",
  linearIssueId: "issue-a",
  linearIssueIdentifier: "ENG-1",
  linearIssueDescription: null,
  linearIssueTitle: "Title A",
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
};

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state and resolves to the fetched runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([runA]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch fails with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("not an error object");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes the API and updates runs", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const runB = { ...runA, id: "run-b" };
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA, runB] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual([runA, runB]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("refetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    act(() => {
      sseCallback!({ type: "run:created", runId: "run-a" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([runA]));
  });

  it("patches a run's state in place on a run:state-changed SSE event without refetching", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "run-a", to: "Planning" });
    });

    expect(result.current.runs).toEqual([{ ...runA, state: "Planning" }]);
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores SSE event types other than run:created and run:state-changed", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseCallback!({ type: "process:started", runId: "run-a" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([runA]);
  });

  it("ignores a run:state-changed event for a run id that isn't in the list", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "nonexistent", to: "Planning" });
    });

    expect(result.current.runs).toEqual([runA]);
  });
});
