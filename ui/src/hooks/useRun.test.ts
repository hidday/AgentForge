import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun.ts";
import type { DashboardEvent } from "./useSSE.ts";

const sseHandlers: ((event: DashboardEvent) => void)[] = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandlers.push(handler);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getRun: vi.fn() },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

describe("useRun", () => {
  beforeEach(() => {
    sseHandlers.length = 0;
    vi.clearAllMocks();
  });

  it("fetches the run on mount and exposes loading/data state", async () => {
    const runDetail = { run: { id: "run-1" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(runDetail);

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error throw", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for the same run arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "run-1" }, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      sseHandlers[0]({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));
  });

  it("ignores an SSE event for a different run", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "run-1" }, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      sseHandlers[0]({ type: "run:state-changed", runId: "run-2" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });

  it("exposes a refetch function that re-runs the fetch", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "run-1" }, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
