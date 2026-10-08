import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({ api: { getRuns: vi.fn() } }));

let sseCallback: ((e: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (e: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const getRuns = api.getRuns as unknown as ReturnType<typeof vi.fn>;
const runs = [
  { id: "r1", state: "Planning" },
  { id: "r2", state: "Todo" },
];

beforeEach(() => {
  getRuns.mockReset();
  sseCallback = null;
});

describe("useRuns", () => {
  it("fetches runs with the given state filter", async () => {
    getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns("Planning"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(getRuns).toHaveBeenCalledWith("Planning");
  });

  it("reports errors and keeps runs empty", async () => {
    getRuns.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce({});
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("offline"));
    expect(result.current.runs).toEqual([]);
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches on run:created", async () => {
    getRuns.mockResolvedValue({ runs });
    renderHook(() => useRuns());
    await waitFor(() => expect(getRuns).toHaveBeenCalledTimes(1));
    act(() => sseCallback!({ type: "run:created", runId: "r3" }));
    await waitFor(() => expect(getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches the matching run's state locally on run:state-changed", async () => {
    getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(2));
    act(() => sseCallback!({ type: "run:state-changed", runId: "r1", to: "Done" }));
    expect(result.current.runs).toEqual([
      { id: "r1", state: "Done" },
      { id: "r2", state: "Todo" },
    ]);
    expect(getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated event types", async () => {
    getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(2));
    act(() => sseCallback!({ type: "process:output", runId: "r1", chunk: "hi" }));
    expect(result.current.runs).toEqual(runs);
    expect(getRuns).toHaveBeenCalledTimes(1);
  });
});
