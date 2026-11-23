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

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function run(id: string, state: string): Run {
  return { id, state } as Run;
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches runs on mount with no filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([run("r1", "Todo")]);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("re-fetches when the state filter changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { rerender } = renderHook(({ filter }) => useRuns(filter), {
      initialProps: { filter: undefined as string | undefined },
    });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    rerender({ filter: "Done" });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(mockApi.getRuns).toHaveBeenLastCalledWith("Done");
  });

  it("surfaces an error message on failure", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("oops");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("re-fetches the whole list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    await act(async () => {
      handler({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches a single run's state in place on run:state-changed, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run("r1", "Todo"), run("r2", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(2));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs.find((r) => r.id === "r1")!.state).toBe("Done");
    expect(result.current.runs.find((r) => r.id === "r2")!.state).toBe("Todo");
  });

  it("ignores SSE events that are neither run:created nor run:state-changed", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run("r1", "Todo")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual([run("r1", "Todo")]);
  });

  it("refetch() re-invokes the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });
});
