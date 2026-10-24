import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

const sseCallbacks: Array<(event: DashboardEvent) => void> = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallbacks.push(cb);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getRun: vi.fn() },
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks.length = 0;
  });

  it("fetches the run on mount and exposes the result", async () => {
    const detail = { run: { id: "r1", state: "Implementing" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("surfaces the error message when the fetch fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for the same run arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "r1" }, artifacts: [], events: [] });

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallbacks[0]!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "r1" }, artifacts: [], events: [] });

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallbacks[0]!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-runs the fetch", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "r1" }, artifacts: [], events: [] });

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });
});
