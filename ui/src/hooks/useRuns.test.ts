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
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { useRuns } from "./useRuns";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
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
    latestArtifactVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state and fetches on mount", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch fails", async () => {
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

  it("refetch() re-requests the run list and clears a previous error", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun("r1", "Todo")] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toHaveLength(1);
  });

  it("refetches the run list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun("new-run", "Todo")] });
    act(() => {
      sseCallback!({ type: "run:created", runId: "new-run" });
    });

    await waitFor(() => expect(result.current.runs).toHaveLength(1));
  });

  it("patches an existing run's state in place on a run:state-changed SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    expect(result.current.runs[0]!.state).toBe("Done");
    // Should not have triggered an extra fetch for a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores a run:state-changed event for a run that isn't in the current list", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "unknown-run", to: "Done" });
    });

    expect(result.current.runs[0]!.state).toBe("Todo");
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs[0]!.state).toBe("Todo");
  });
});
