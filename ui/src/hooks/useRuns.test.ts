import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseHandler: ((event: unknown) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: unknown) => void) => {
    sseHandler = cb;
  }),
}));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts in a loading state and fetches runs with no filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1" }] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([{ id: "r1" }]);
    expect(result.current.error).toBeNull();
  });

  it("passes the stateFilter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("running"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("running"));
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

  it("refetch() re-invokes api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1" }, { id: "r2" }] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual([{ id: "r1" }, { id: "r2" }]);
  });

  it("on SSE run:created event, refetches runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1" }, { id: "r2" }] });
    expect(sseHandler).not.toBeNull();
    await act(async () => {
      sseHandler!({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([{ id: "r1" }, { id: "r2" }]));
  });

  it("on SSE run:state-changed event, patches the matching run's state locally without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "planning" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "executing" });
    });

    expect(result.current.runs).toEqual([{ id: "r1", state: "executing" }]);
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores SSE events of types other than run:created / run:state-changed", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "planning" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([{ id: "r1", state: "planning" }]);
  });

  it("run:state-changed event for a non-matching runId leaves other runs untouched", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "r1", state: "planning" },
        { id: "r2", state: "planning" },
      ],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r2", to: "executing" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "planning" },
      { id: "r2", state: "executing" },
    ]);
  });
});
