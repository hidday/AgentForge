import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

const sseHandlers: Array<(event: unknown) => void> = [];
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: unknown) => void) => {
    sseHandlers.push(handler);
  },
}));

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandlers.length = 0;
  });

  it("starts in a loading state with no runs", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads runs successfully and clears loading state", async () => {
    const runs = [{ id: "r1", state: "Executing" }];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the api call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("Paused"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Paused"));
  });

  it("sets an error message when the fetch fails with an Error", async () => {
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

  it("refetches runs when an SSE run:created event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "new", state: "Planning" }] });

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "run:created", runId: "new" });
    });

    await waitFor(() =>
      expect(result.current.runs).toEqual([{ id: "new", state: "Planning" }]),
    );
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("locally patches a run's state on a run:state-changed event without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Planning" }] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "run:state-changed",
        runId: "r1",
        to: "Executing",
      });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Executing" }]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched on a run:state-changed event for a different run", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "r1", state: "Planning" },
        { id: "r2", state: "Planning" },
      ],
    });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "run:state-changed",
        runId: "r2",
        to: "Executing",
      });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "Planning" },
      { id: "r2", state: "Executing" },
    ]);
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Planning" }] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Planning" }]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-fetches runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Planning" }] });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Planning" }]);
  });
});
