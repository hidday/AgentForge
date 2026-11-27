import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading with an empty runs array", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("fetches runs with no filter on mount", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Running" }] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([{ id: "r1", state: "Running" }]);
  });

  it("passes the stateFilter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Completed"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Completed"));
  });

  it("sets an error message on failure", async () => {
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

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Running" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "r1", state: "Running" },
        { id: "r2", state: "Running" },
      ],
    });
    act(() => {
      sseHandler!({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(result.current.runs.length).toBe(2));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("patches a single run's state in place on a run:state-changed event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Running" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "Completed" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Completed" }]);
    // No additional fetch should have occurred for a state-changed event
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched when patching by id", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "r1", state: "Running" },
        { id: "r2", state: "Running" },
      ],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r2", to: "Failed" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "Running" },
      { id: "r2", state: "Failed" },
    ]);
  });

  it("ignores SSE event types it does not handle", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Running" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Running" }]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalled();
  });
});
