import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

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
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN_ID = "run-1";
const detail = { run: { id: RUN_ID, state: "executing" }, artifacts: [], events: [] };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading with null data", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun(RUN_ID));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run by id and exposes the result shape on success", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("exposes a working refetch that clears a prior error on success", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRun.mockResolvedValueOnce(detail);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(detail);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("refetches when an SSE event for this runId arrives", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: RUN_ID });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });
});
