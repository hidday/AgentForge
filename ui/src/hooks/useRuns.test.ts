import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";

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

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

const run1 = { id: "r1", state: "pending" } as const;
const run2 = { id: "r2", state: "running" } as const;

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts in a loading state with no runs and no error", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads runs successfully and clears loading", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([run1, run2]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("running"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("running"));
  });

  it("sets an error message when the fetch fails with an Error", async () => {
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

  it("refetch re-invokes the API and clears a previous error on success", async () => {
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

  it("refetches all runs on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [run1, run2] });
    await act(async () => {
      sseHandler?.({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([run1, run2]));
  });

  it("patches a single run's state in place on a run:state-changed SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual([run1, run2]));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "r1", to: "completed" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "completed" },
      run2,
    ]);
    // getRuns should not have been called again for a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it does not recognize", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual([run1]));

    act(() => {
      sseHandler?.({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([run1]);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
