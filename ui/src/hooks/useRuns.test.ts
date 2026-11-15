import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("fetches runs on mount and exposes them once loaded", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "run-1", state: "Todo" }] });

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([{ id: "run-1", state: "Todo" }]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the API call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Implementing"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Implementing"));
  });

  it("records an error message when the fetch rejects", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list when a run:created event arrives", async () => {
    mockApi.getRuns
      .mockResolvedValueOnce({ runs: [{ id: "run-1", state: "Todo" }] })
      .mockResolvedValueOnce({
        runs: [
          { id: "run-1", state: "Todo" },
          { id: "run-2", state: "Todo" },
        ],
      });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      capturedHandler!({ type: "run:created", runId: "run-2" });
    });

    await waitFor(() => expect(result.current.runs).toHaveLength(2));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("patches a single run's state in place on a run:state-changed event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [{ id: "run-1", state: "Todo" }],
    });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1", to: "Implementing" });
    });

    expect(result.current.runs[0]!.state).toBe("Implementing");
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched when patching state for one run", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "run-1", state: "Todo" },
        { id: "run-2", state: "Todo" },
      ],
    });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1", to: "Done" });
    });

    expect(result.current.runs.find((r) => r.id === "run-1")!.state).toBe("Done");
    expect(result.current.runs.find((r) => r.id === "run-2")!.state).toBe("Todo");
  });

  it("ignores SSE event types it doesn't handle, without refetching or mutating runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "run-1", state: "Todo" }] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      capturedHandler!({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.runs).toEqual([{ id: "run-1", state: "Todo" }]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
