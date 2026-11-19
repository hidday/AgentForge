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

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches runs with no filter by default", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "run-1", state: "Todo" }] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([{ id: "run-1", state: "Todo" }]);
  });

  it("refetches when the state filter changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { rerender } = renderHook(({ state }) => useRuns(state), {
      initialProps: { state: undefined as string | undefined },
    });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    rerender({ state: "Done" });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(mockApi.getRuns).toHaveBeenLastCalledWith("Done");
  });

  it("sets an error message on failure", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server unavailable"));

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("server unavailable"));
    expect(result.current.runs).toEqual([]);
  });

  it("refetches the full list on a run:created event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => sseCallback!({ type: "run:created", runId: "run-2" }));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches an individual run's state in place on a run:state-changed event without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [{ id: "run-1", state: "Todo" }, { id: "run-2", state: "Todo" }],
    });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => sseCallback!({ type: "run:state-changed", runId: "run-1", to: "Done" }));

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual([
      { id: "run-1", state: "Done" },
      { id: "run-2", state: "Todo" },
    ]);
  });
});
