import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => sseCallback!(event));
}

const runA = { id: "r1", state: "Todo" } as never;
const runB = { id: "r2", state: "Planning" } as never;

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state and then resolves with runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([runA, runB]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("nope");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes api.getRuns and clears an existing error on success", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA, runB] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual([runA, runB]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("re-fetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [runA, runB] });
    fireSSE({ type: "run:created", runId: "r2" });

    await waitFor(() => expect(result.current.runs).toEqual([runA, runB]));
  });

  it("updates a run's state in place on a run:state-changed SSE event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    fireSSE({ type: "run:state-changed", runId: "r1", to: "Done" });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "r1")?.state).toBe("Done"),
    );
    expect(result.current.runs.find((r) => r.id === "r2")?.state).toBe("Planning");
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores SSE event types it does not handle", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    fireSSE({ type: "process:started", runId: "r1" });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([runA]);
  });
});
