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

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

const detail = { run: { id: "run-1" }, artifacts: [], events: [] };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("loads run detail for the given runId", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run missing"));
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("run missing");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("nope");
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() calls api.getRun again", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    fireSSE({ type: "run:state-changed", runId: "run-other" });
    expect(mockApi.getRun).not.toHaveBeenCalled();
  });

  it("refetches on any SSE event matching this runId", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    fireSSE({ type: "run:state-changed", runId: "run-1" });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));
  });
});
