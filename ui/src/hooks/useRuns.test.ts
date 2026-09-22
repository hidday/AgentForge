import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ISS-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with no runs and no error", async () => {
    let resolveFetch!: (v: { runs: Run[] }) => void;
    mockApi.getRuns.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveFetch({ runs: [] });
    });
  });

  it("fetches runs with the given state filter and updates state on success", async () => {
    const runs = [makeRun("r1", "Planning")];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith("Planning");
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
  });

  it("sets error state and stops loading when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes the API and updates runs", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const runs = [makeRun("r2", "Done")];
    mockApi.getRuns.mockResolvedValueOnce({ runs });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual(runs);
  });

  it("re-fetches runs on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newRuns = [makeRun("r3", "Todo")];
    mockApi.getRuns.mockResolvedValueOnce({ runs: newRuns });

    await act(async () => {
      sseCallback!({ type: "run:created", runId: "r3" });
    });

    await waitFor(() => expect(result.current.runs).toEqual(newRuns));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("updates a run's state in place on a run:state-changed SSE event without refetching", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun("r1", "Planning")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    expect(result.current.runs).toEqual([makeRun("r1", "Implementing")]);
    // Only the initial fetch — no refetch for state-changed events
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores run:state-changed events for runs not in the current list", async () => {
    const originalRuns = [makeRun("r1", "Planning")];
    mockApi.getRuns.mockResolvedValueOnce({ runs: originalRuns });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "unknown-run", to: "Done" });
    });

    expect(result.current.runs).toEqual(originalRuns);
  });

  it("ignores unrelated SSE event types", async () => {
    const originalRuns = [makeRun("r1", "Planning")];
    mockApi.getRuns.mockResolvedValueOnce({ runs: originalRuns });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual(originalRuns);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
