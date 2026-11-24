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

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

const run1 = { id: "r1", state: "Planning" };
const run2 = { id: "r2", state: "Done" };

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches runs on mount with no state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([run1, run2]);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run2] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch rejects", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("Server unavailable"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Server unavailable");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list on a 'run:created' SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });

    await act(async () => {
      sseCallback!({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([run1, run2]));
  });

  it("patches a run's state in place on a 'run:state-changed' event, without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs.find((r) => r.id === "r1")?.state).toBe("Implementing");
    expect(result.current.runs.find((r) => r.id === "r2")?.state).toBe("Done");
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    await act(async () => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([run1]);
  });
});
