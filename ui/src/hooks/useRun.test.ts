import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const detail = { run: { id: "r1", state: "Todo" }, artifacts: [], events: [] };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading and null data, then resolves with the fetched run detail", async () => {
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch re-requests the run and clears a previous error on success", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRun.mockResolvedValueOnce(detail);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(detail);
  });

  it("refetches when an SSE event for this run arrives", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { run: { id: "r1", state: "Planning" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValueOnce(updated);

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "Planning" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(detail);
  });
});
