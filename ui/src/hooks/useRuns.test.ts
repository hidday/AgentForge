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
  act(() => {
    sseCallback!(event);
  });
}

const runA = { id: "r1", state: "Todo" } as never;
const runB = { id: "r2", state: "Done" } as never;

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state and fetches all runs when no filter is given", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([runA, runB]);
    expect(result.current.error).toBeNull();
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch fails", async () => {
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

  it("re-fetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    fireSSE({ type: "run:created", runId: "r2" });

    await waitFor(() => expect(result.current.runs).toEqual([runA, runB]));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("patches a run's state in place on a run:state-changed event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "r1", to: "Implementing" });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "r1")?.state).toBe("Implementing"),
    );
    expect(result.current.runs.find((r) => r.id === "r2")?.state).toBe("Done");
    // No extra fetch triggered by this event type.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it doesn't handle, without refetching or changing runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:artifact-created", runId: "r1" });
    await Promise.resolve();

    expect(result.current.runs).toEqual([runA, runB]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("refetch() exposed on the hook re-invokes api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });
});
