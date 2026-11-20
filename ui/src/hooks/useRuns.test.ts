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

const run1 = { id: "run-1", state: "Planning" };
const run2 = { id: "run-2", state: "Implementing" };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with an empty runs array", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
  });

  it("fetches runs on mount with no state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([run1, run2]);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("sets an error message and stops loading when the fetch rejects", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list when a run:created SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    act(() => {
      sseCallback!({ type: "run:created", runId: "run-2" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([run1, run2]));
  });

  it("patches a run's state in place on a run:state-changed SSE event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "run-1", to: "Done" });
    });

    expect(result.current.runs.find((r) => r.id === "run-1")?.state).toBe("Done");
    expect(result.current.runs.find((r) => r.id === "run-2")?.state).toBe("Implementing");
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("refetch() re-invokes api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual([run1, run2]);
  });
});
