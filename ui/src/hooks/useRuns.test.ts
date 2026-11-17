import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

const sseCallback: { current: ((event: DashboardEvent) => void) | null } = { current: null };
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback.current = cb;
  },
}));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "repo",
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

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback.current = null;
  });

  it("fetches all runs with no filter and exposes them once loaded", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
  });

  it("passes the stateFilter through to the API and refetches when it changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result, rerender } = renderHook(({ state }: { state?: string }) => useRuns(state), {
      initialProps: { state: "Planning" as string | undefined },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith("Planning");

    rerender({ state: "Done" });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("surfaces an error message when the fetch rejects, with a generic fallback for non-Error throws", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("server down"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);

    mockApi.getRuns.mockRejectedValueOnce("boom");
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    act(() => sseCallback.current!({ type: "run:created", runId: "run-2" }));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches the matching run's state in place on a run:state-changed event, without refetching", async () => {
    const runs = [makeRun({ id: "run-1", state: "Planning" }), makeRun({ id: "run-2", state: "Planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => sseCallback.current!({ type: "run:state-changed", runId: "run-1", to: "Done" }));

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs.find((r) => r.id === "run-1")!.state).toBe("Done");
    expect(result.current.runs.find((r) => r.id === "run-2")!.state).toBe("Planning");
  });

  it("ignores SSE events of an unrelated type", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => sseCallback.current!({ type: "process:started", runId: "run-1" }));

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual(runs);
  });
});
