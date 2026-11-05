import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

const RUNS = [
  { id: "run-1", state: "planning" },
  { id: "run-2", state: "executing" },
];

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading with an empty runs array and no error", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("populates runs on success and calls the API without a filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: RUNS });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(RUNS);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("blocked"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("blocked"));
  });

  it("surfaces an Error's message on failure, leaving runs empty", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server exploded"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server exploded");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("nope");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-queries and can recover from a previous error", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRuns.mockResolvedValueOnce({ runs: RUNS });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toEqual(RUNS);
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: RUNS });

    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    fireSSE({ type: "run:created", runId: "run-3" });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches a single run's state in place on a run:state-changed event (no refetch)", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: RUNS });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(RUNS));

    fireSSE({ type: "run:state-changed", runId: "run-1", to: "blocked" });

    await waitFor(() => {
      expect(result.current.runs.find((r) => r.id === "run-1")?.state).toBe("blocked");
    });
    // The other run is untouched.
    expect(result.current.runs.find((r) => r.id === "run-2")?.state).toBe("executing");
    // No extra fetch happened for a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it doesn't handle", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: RUNS });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(RUNS));

    fireSSE({ type: "process:started", runId: "run-1" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.runs).toEqual(RUNS);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
