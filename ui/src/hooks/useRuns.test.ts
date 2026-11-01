import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE";

vi.mock("@/api/client.ts", () => ({
  api: { getRuns: vi.fn() },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

import { useRuns } from "./useRuns";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts in a loading state and fetches with no filter by default", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Todo" }] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([{ id: "r1", state: "Todo" }]);
    expect(result.current.error).toBeNull();
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("surfaces an Error's message on fetch failure", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    mockApi.getRuns.mockRejectedValue("just a string");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "new", state: "Todo" }] });
    act(() => {
      sseHandler?.({ type: "run:created", runId: "new" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([{ id: "new", state: "Todo" }]));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("patches the matching run's state in-place on a run:state-changed event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "r1", state: "Todo" },
        { id: "r2", state: "Todo" },
      ],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "Done" },
      { id: "r2", state: "Todo" },
    ]);
    // Patched locally — no extra network round-trip.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it doesn't handle", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Todo" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler?.({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Todo" }]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("exposes a manual refetch function", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });
});
