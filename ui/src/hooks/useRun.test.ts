import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const detail = { run: { id: "r1", state: "running" }, artifacts: [], events: [] };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading with null data, then resolves with run detail", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets error message on rejection and keeps data null", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.error).toBe("not found"));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("oops");
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch run"));
  });

  it("refetch() calls api.getRun again and updates data", async () => {
    mockApi.getRun.mockResolvedValueOnce(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { run: { id: "r1", state: "review" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValueOnce(updated);
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual(updated);
  });

  it("refetches on an SSE event matching this run's id", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
