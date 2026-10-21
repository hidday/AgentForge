import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("./useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("./useSSE.ts")>("./useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

const runA = { id: "run-a", state: "Planning" };
const runB = { id: "run-b", state: "Done" };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state and resolves with fetched runs", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA, runB] });

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual([runA, runB]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to the api call", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });

    renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("surfaces an error message when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRuns.mockRejectedValueOnce("not an Error instance");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches all runs on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA, runB] });
    act(() => {
      sseCallback?.({ type: "run:created", runId: "run-b" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([runA, runB]));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("patches a single run's state in place on a run:state-changed event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback?.({ type: "run:state-changed", runId: "run-a", to: "Done" });
    });

    expect(result.current.runs).toEqual([{ id: "run-a", state: "Done" }, runB]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it doesn't handle", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback?.({ type: "process:started", runId: "run-a" });
    });

    expect(result.current.runs).toEqual([runA]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-runs the fetch", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual([runA]);
  });
});
