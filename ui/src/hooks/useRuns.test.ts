import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

const sseCallbacks: Array<(event: DashboardEvent) => void> = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallbacks.push(cb);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getRuns: vi.fn() },
}));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks.length = 0;
  });

  it("fetches runs on mount with no state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Todo" }] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([{ id: "r1", state: "Todo" }]);
    expect(result.current.error).toBeNull();
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("Done"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("re-fetches with the new filter when stateFilter changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { rerender } = renderHook(({ state }) => useRuns(state), {
      initialProps: { state: undefined as string | undefined },
    });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    rerender({ state: "Implementing" });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(mockApi.getRuns).toHaveBeenLastCalledWith("Implementing");
  });

  it("surfaces an error message when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRuns.mockRejectedValue("boom");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallbacks[0]!({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches the matching run's state in place on a run:state-changed event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [{ id: "r1", state: "Todo" }, { id: "r2", state: "Todo" }],
    });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallbacks[0]!({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "Implementing" },
      { id: "r2", state: "Todo" },
    ]);
    // No refetch triggered by a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Todo" }] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallbacks[0]!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Todo" }]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
