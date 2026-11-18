import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const runDetail = {
  run: { id: "run-1", state: "Planning" },
  artifacts: [],
  events: [],
};

function fireSSE(event: DashboardEvent) {
  act(() => {
    sseCallback?.(event);
  });
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches the run by id and exposes loading -> loaded transition", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch rejects", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("run-x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("run-x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("re-fetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Implementing" } };
    mockApi.getRun.mockResolvedValue(updated);
    fireSSE({ type: "run:state-changed", runId: "run-1" });

    await waitFor(() => expect(result.current.data?.run.state).toBe("Implementing"));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "run-2" });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });
});
