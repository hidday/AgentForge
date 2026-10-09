import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun";
import type { DashboardEvent } from "./useSSE";

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

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const runDetail = {
  run: { id: "run-1", state: "Todo" },
  artifacts: [{ id: "a1" }],
  events: [{ id: "e1" }],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading and resolves with run detail data", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch fails with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes the API", async () => {
    mockApi.getRun.mockResolvedValueOnce(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Planning" } };
    mockApi.getRun.mockResolvedValueOnce(updated);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("refetches on an SSE event matching this runId", async () => {
    mockApi.getRun.mockResolvedValueOnce(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Planning" } };
    mockApi.getRun.mockResolvedValueOnce(updated);
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores an SSE event for a different runId", async () => {
    mockApi.getRun.mockResolvedValueOnce(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(runDetail);
  });
});
