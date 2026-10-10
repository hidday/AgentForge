import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
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

const mockApi = api as unknown as {
  getRun: ReturnType<typeof vi.fn>;
};

const runDetail = {
  run: { id: "run-1", state: "running" },
  artifacts: [],
  events: [],
};

beforeEach(() => {
  sseCallback = null;
  mockApi.getRun.mockReset();
});

describe("useRun", () => {
  it("fetches the run on mount and exposes loading -> success", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("tracks an error message when the fetch fails with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a default error message for a non-Error throw", async () => {
    mockApi.getRun.mockRejectedValue("not an error object");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch re-invokes the api call and updates data", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "completed" } };
    mockApi.getRun.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(updated);
  });

  it("refetches on an SSE event matching this runId", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    const updated = { ...runDetail, run: { ...runDetail.run, state: "completed" } };
    mockApi.getRun.mockResolvedValue(updated);

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
    expect(result.current.data).toEqual(updated);
  });

  it("ignores an SSE event for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(runDetail);
  });
});
