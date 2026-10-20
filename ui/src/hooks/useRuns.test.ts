import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

const run1 = { id: "r1", state: "Planning" } as never;
const run2 = { id: "r2", state: "Executing" } as never;

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state with an empty runs array", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("fetches runs with no filter on mount and resolves into state", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([run1, run2]);
    expect(result.current.error).toBeNull();
  });

  it("passes the stateFilter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith("Planning");
  });

  it("refetches when stateFilter changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result, rerender } = renderHook(({ filter }) => useRuns(filter), {
      initialProps: { filter: undefined as string | undefined },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    rerender({ filter: "Done" });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(mockApi.getRuns).toHaveBeenLastCalledWith("Done");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValue("some string failure");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("clears a previous error on a successful refetch", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [run1] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toEqual([run1]);
  });

  it("registers an SSE handler and refetches on run:created", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    mockApi.getRuns.mockResolvedValueOnce({ runs: [run1, run2] });
    await act(async () => {
      latestHandler()({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([run1, run2]));
  });

  it("patches a run's state in place on run:state-changed without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    act(() => {
      latestHandler()({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    expect(result.current.runs.find((r) => r.id === "r1")!.state).toBe("Done");
    expect(result.current.runs.find((r) => r.id === "r2")!.state).toBe("Executing");
    // no refetch triggered by state-changed
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      latestHandler()({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([run1]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
