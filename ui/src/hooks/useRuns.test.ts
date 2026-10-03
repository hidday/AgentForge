import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("./useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("./useSSE.ts")>("./useSSE.ts");
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

const runA = { id: "run-a", state: "Planning" };
const runB = { id: "run-b", state: "Done" };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

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

  it("fetches runs on mount with no state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([runA, runB]);
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });
    const { result } = renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRuns).toHaveBeenCalledWith("Planning");
    expect(result.current.runs).toEqual([runA]);
  });

  it("refetches when the state filter argument changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });
    const { result, rerender } = renderHook(({ filter }) => useRuns(filter), {
      initialProps: { filter: undefined as string | undefined },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    mockApi.getRuns.mockResolvedValue({ runs: [runB] });
    rerender({ filter: "Done" });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(mockApi.getRuns).toHaveBeenLastCalledWith("Done");
    await waitFor(() => expect(result.current.runs).toEqual([runB]));
  });

  it("sets the Error message on rejection and leaves runs empty", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue(42);
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:created", runId: "run-c" });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches a run's state in place on run:state-changed without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [runA, runB] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "run-a", to: "Done" });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "run-a")?.state).toBe("Done"),
    );
    // No extra fetch triggered — this was a local patch.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    // The other run is untouched.
    expect(result.current.runs.find((r) => r.id === "run-b")?.state).toBe("Done");
  });
});
