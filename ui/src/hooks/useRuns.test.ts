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

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading with an empty runs array", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("fetches runs without a state filter by default", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "active" }] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([{ id: "r1", state: "active" }]);
  });

  it("passes the state filter through to the API and refetches when it changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { rerender } = renderHook(({ state }: { state?: string }) => useRuns(state), {
      initialProps: { state: undefined as string | undefined },
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith(undefined));

    rerender({ state: "done" });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("done"));
  });

  it("sets an error message and stops loading when the fetch rejects", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValue(42);

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-requests runs and clears a previous error", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.error).toBe("boom"));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [{ id: "r2" }] });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toEqual([{ id: "r2" }]);
  });

  it("refetches the list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    act(() => {
      latestHandler()({ type: "run:created", runId: "r9" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("updates a single run's state in place on a run:state-changed SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "r1", state: "pending" },
        { id: "r2", state: "pending" },
      ],
    });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.runs).toHaveLength(2));

    act(() => {
      latestHandler()({ type: "run:state-changed", runId: "r1", to: "done" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "done" },
      { id: "r2", state: "pending" },
    ]);
    // No extra fetch triggered by a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "pending" }] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      latestHandler()({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual([{ id: "r1", state: "pending" }]);
  });
});
