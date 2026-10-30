import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: { getRuns: vi.fn() },
}));
vi.mock("./useSSE.ts", () => ({ useSSE: vi.fn() }));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeRun(id: string, state: string): Run {
  return { id, state } as Run;
}

describe("useRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches runs on mount without a state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "running")] });
    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([makeRun("r1", "running")]);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("completed"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("completed"));
  });

  it("sets an error message from an Error rejection", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("down"));
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValueOnce(42);
    const { result } = renderHook(() => useRuns("paused"));
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch runs"));
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const handleSSE = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    await act(async () => {
      handleSSE({ type: "run:created", runId: "r9" });
    });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches a matching run's state in place on run:state-changed without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [makeRun("r1", "running"), makeRun("r2", "running")],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs.length).toBe(2));
    mockApi.getRuns.mockClear();

    const handleSSE = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handleSSE({ type: "run:state-changed", runId: "r1", to: "completed" });
    });

    expect(result.current.runs.find((r) => r.id === "r1")?.state).toBe("completed");
    expect(result.current.runs.find((r) => r.id === "r2")?.state).toBe("running");
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores SSE events of other types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "running")] });
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const handleSSE = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handleSSE({ type: "process:started", runId: "r1" });
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
