import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts in a loading state with no runs and no error", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("populates runs after a successful fetch and clears loading", async () => {
    const runs = [{ id: "r1" }, { id: "r2" }];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("sets an error message and stops loading when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error instance", async () => {
    mockApi.getRuns.mockRejectedValue("boom");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes api.getRuns and updates state", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newRuns = [{ id: "r3" }];
    mockApi.getRuns.mockResolvedValueOnce({ runs: newRuns });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual(newRuns);
  });

  it("refetches all runs on a 'run:created' SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newRuns = [{ id: "new-run" }];
    mockApi.getRuns.mockResolvedValueOnce({ runs: newRuns });

    await act(async () => {
      sseHandler!({ type: "run:created", runId: "new-run" });
    });

    await waitFor(() => expect(result.current.runs).toEqual(newRuns));
  });

  it("patches a single run's state in place on a 'run:state-changed' SSE event", async () => {
    const runs = [{ id: "r1", state: "Planning" }, { id: "r2", state: "Planning" }];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "Implementing" },
      { id: "r2", state: "Planning" },
    ]);
    // api.getRuns should not have been called again for a state-changed event
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it does not handle", async () => {
    const runs = [{ id: "r1", state: "Planning" }];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual(runs);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
