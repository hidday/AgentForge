import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

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
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(id: string, state: string) {
  return {
    id,
    linearIssueId: "li1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
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

  it("starts in a loading state with an empty runs array", async () => {
    let resolveFn!: (v: { runs: unknown[] }) => void;
    mockApi.getRuns.mockReturnValue(new Promise((res) => (resolveFn = res)));

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();

    resolveFn({ runs: [] });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("populates runs after the fetch resolves and calls api.getRuns with no filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "running")] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([makeRun("r1", "running")]);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("failed"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("failed"));
  });

  it("sets an error message when the fetch rejects", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.loading).toBe(false);
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("not an error object");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch runs"));
  });

  it("refetch() re-invokes api.getRuns and updates data", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun("r2", "done")] });
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.runs).toEqual([makeRun("r2", "done")]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("refetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallback!({ type: "run:created", runId: "r3" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("applies a run:state-changed SSE event by patching the matching run's state locally", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "running")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "review" });
    });

    expect(result.current.runs[0]!.state).toBe("review");
    // No extra fetch triggered by a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types other than run:created and run:state-changed", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "running")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([makeRun("r1", "running")]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves runs unchanged when the state-changed event targets a different run id", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "running")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other", to: "review" });
    });

    expect(result.current.runs[0]!.state).toBe("running");
  });
});
