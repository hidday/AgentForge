import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";
import type { DashboardEvent } from "./useSSE.ts";

const sseHandlers: ((event: DashboardEvent) => void)[] = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandlers.push(handler);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getRuns: vi.fn() },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    sseHandlers.length = 0;
    vi.clearAllMocks();
  });

  it("fetches runs on mount, forwarding the state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "run-1", state: "Todo" }] });

    const { result } = renderHook(() => useRuns("Todo"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual([{ id: "run-1", state: "Todo" }]);
    expect(mockApi.getRuns).toHaveBeenCalledWith("Todo");
  });

  it("sets an error message when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error throw", async () => {
    mockApi.getRuns.mockRejectedValue("boom");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseHandlers[0]({ type: "run:created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));
  });

  it("patches a single run's state in place on a run:state-changed event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "run-1", state: "Todo" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseHandlers[0]({ type: "run:state-changed", runId: "run-1", to: "Planning" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.runs[0].state).toBe("Planning"));
  });

  it("leaves other runs untouched when patching state", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "run-1", state: "Todo" },
        { id: "run-2", state: "Todo" },
      ],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandlers[0]({ type: "run:state-changed", runId: "run-1", to: "Planning" });
    });

    await waitFor(() => {
      expect(result.current.runs.find((r) => r.id === "run-1")?.state).toBe("Planning");
      expect(result.current.runs.find((r) => r.id === "run-2")?.state).toBe("Todo");
    });
  });

  it("ignores SSE event types it does not handle", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "run-1", state: "Todo" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseHandlers[0]({ type: "process:output", runId: "run-1", chunk: "x" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs[0].state).toBe("Todo");
  });
});
