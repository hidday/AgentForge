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

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const detail = {
  run: { id: "run-1", state: "Planning" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches the run detail for the given runId on mount", async () => {
    mockApi.getRun.mockResolvedValueOnce(detail);

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("surfaces an Error's message on failure", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("not found"));

    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRun.mockRejectedValueOnce("oops");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValueOnce(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback?.({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("refetches on an SSE event for this runId", async () => {
    mockApi.getRun.mockResolvedValueOnce(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...detail, run: { ...detail.run, state: "Done" } };
    mockApi.getRun.mockResolvedValueOnce(updated);
    act(() => {
      sseCallback?.({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("refetches when runId changes", async () => {
    mockApi.getRun.mockResolvedValueOnce(detail);
    const { rerender } = renderHook(({ id }) => useRun(id), {
      initialProps: { id: "run-1" },
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-1"));

    mockApi.getRun.mockResolvedValueOnce({ ...detail, run: { id: "run-2", state: "Planning" } });
    rerender({ id: "run-2" });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-2"));
  });
});
