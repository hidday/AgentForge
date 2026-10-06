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
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN_ID = "run-1";

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading with null data and no error", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: RUN_ID }, artifacts: [], events: [] });

    const { result } = renderHook(() => useRun(RUN_ID));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("populates data after a successful fetch, keyed by runId", async () => {
    const detail = { run: { id: RUN_ID }, artifacts: [{ id: "a1" }], events: [{ id: "e1" }] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith(RUN_ID);
  });

  it("sets an error message and stops loading when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error instance", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes api.getRun and updates data", async () => {
    mockApi.getRun.mockResolvedValueOnce({ run: { id: RUN_ID }, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { run: { id: RUN_ID, state: "Done" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
  });

  it("refetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: RUN_ID }, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { run: { id: RUN_ID, state: "Implementing" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValueOnce(updated);

    await act(async () => {
      sseHandler!({ type: "run:state-changed", runId: RUN_ID });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: RUN_ID }, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    // No additional fetch should have been triggered
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
