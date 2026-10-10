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

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getRuns: ReturnType<typeof vi.fn>;
};

const runA = { id: "run-a", state: "running" };
const runB = { id: "run-b", state: "planning" };

beforeEach(() => {
  sseCallback = null;
  mockApi.getRuns.mockReset();
});

describe("useRuns", () => {
  it("fetches runs on mount and exposes loading -> success", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual([runA, runB]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to the api call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("running"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("running"));
  });

  it("tracks an error message when the fetch fails with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a default error message for a non-Error throw", async () => {
    mockApi.getRuns.mockRejectedValue("nope");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch re-invokes the api call and updates data", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
    expect(result.current.runs).toEqual([runA, runB]);
  });

  it("does a full refetch on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });

    await act(async () => {
      sseCallback!({ type: "run:created", runId: "run-b" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(result.current.runs).toEqual([runA, runB]);
  });

  it("optimistically updates matching run state on run:state-changed without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "run-a", to: "completed" });
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual([
      { ...runA, state: "completed" },
      runB,
    ]);
  });

  it("ignores other event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback!({ type: "process:started", runId: "run-a" });
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual([runA, runB]);
  });
});
