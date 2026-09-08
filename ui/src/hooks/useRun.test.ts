import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  }),
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN_DETAIL = {
  run: { id: "r1", state: "Todo" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading and resolves with run detail data", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run not found"));
    const { result } = renderHook(() => useRun("missing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue("nope");
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch re-invokes the api call", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...RUN_DETAIL, run: { ...RUN_DETAIL.run, state: "Implementing" } };
    mockApi.getRun.mockResolvedValueOnce(updated);
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual(updated);
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("refetches on an SSE event matching this run's id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    renderHook(() => useRun("r1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    renderHook(() => useRun("r1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
