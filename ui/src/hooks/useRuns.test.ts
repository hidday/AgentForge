import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

const run = (id: string, state: string) => ({
  id,
  linearIssueId: "li-1",
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
});

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts in a loading state and resolves with fetched runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run("r1", "Todo")] });

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual([run("r1", "Todo")]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the api call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("boom");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch re-requests runs and clears a previous error on success", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [run("r2", "Done")] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toEqual([run("r2", "Done")]);
  });

  it("refetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [run("r3", "Todo")] });
    act(() => {
      sseHandler!({ type: "run:created", runId: "r3" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([run("r3", "Todo")]));
  });

  it("patches a run's state in place on a run:state-changed event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "Planning" });
    });

    expect(result.current.runs).toEqual([run("r1", "Planning")]);
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores a run:state-changed event for a run that isn't in the current list", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other", to: "Planning" });
    });

    expect(result.current.runs).toEqual([run("r1", "Todo")]);
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([run("r1", "Todo")]);
  });
});
