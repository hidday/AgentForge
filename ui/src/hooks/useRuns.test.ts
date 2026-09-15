import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeRun(id: string, state: string): Run {
  return { id, state } as unknown as Run;
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state with an empty runs list and no error", async () => {
    let resolveFn!: (v: { runs: Run[] }) => void;
    mockApi.getRuns.mockReturnValue(new Promise((res) => (resolveFn = res)));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();

    act(() => resolveFn({ runs: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("populates runs and clears error on a successful fetch, passing the state filter through", async () => {
    const runs = [makeRun("r1", "Todo")];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns("Todo"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith("Todo");
  });

  it("sets a fallback error message when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("sets a generic fallback error message when the fetch rejects with a non-Error value", async () => {
    mockApi.getRuns.mockRejectedValue(42);

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch re-invokes api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    const handler = mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
      e: DashboardEvent,
    ) => void;

    act(() => handler({ type: "run:created", runId: "r-new" }));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches the matching run's state in place on a run:state-changed event, without refetching", async () => {
    const runs = [makeRun("r1", "Todo"), makeRun("r2", "Todo")];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    const handler = mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
      e: DashboardEvent,
    ) => void;

    act(() =>
      handler({ type: "run:state-changed", runId: "r1", to: "Implementing" } as DashboardEvent),
    );

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "r1")?.state).toBe("Implementing"),
    );
    // Untouched run stays as-is.
    expect(result.current.runs.find((r) => r.id === "r2")?.state).toBe("Todo");
    // No refetch was triggered — the array was patched in place.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
