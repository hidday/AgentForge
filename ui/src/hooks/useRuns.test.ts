import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: unknown) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: unknown) => void) => {
    sseCallback = cb;
  }),
}));

import { useRuns } from "./useRuns";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state and fetches runs on mount", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Todo" }] });

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual([{ id: "r1", state: "Todo" }]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
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

  it("refetch() re-invokes api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r2", state: "Done" }] });

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual([{ id: "r2", state: "Done" }]);
  });

  it("re-fetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "new", state: "Todo" }] });

    await act(async () => {
      sseCallback!({ type: "run:created", runId: "new" });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.runs).toEqual([{ id: "new", state: "Todo" }]));
  });

  it("patches a run's state in place on a run:state-changed SSE event without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [{ id: "r1", state: "Todo" }],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Planning" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Planning" }]);
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores a run:state-changed event for a run not in the current list", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Todo" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other", to: "Planning" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "Todo" }]);
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Todo" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([{ id: "r1", state: "Todo" }]);
  });
});
