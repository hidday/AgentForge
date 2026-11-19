import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
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

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches the run on mount and exposes the result", async () => {
    const detail = { run: { id: "run-1" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.error).toBe("not found"));
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch run"));
  });

  it("refetches when an SSE event for this run arrives, and ignores events for other runs", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "run-1" }, artifacts: [], events: [] });

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("exposes a manual refetch function", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "run-1" }, artifacts: [], events: [] });

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });
});
