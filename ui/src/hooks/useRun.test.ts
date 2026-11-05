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

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

const RUN_DETAIL = {
  run: { id: "run-1", state: "planning" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with no data or error", async () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("populates data and clears loading on successful fetch", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("surfaces an Error's message in the error state instead of throwing", async () => {
    mockApi.getRun.mockRejectedValue(new Error("Run not found"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes the API and can clear a previous error", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRun.mockResolvedValueOnce(RUN_DETAIL);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when an SSE event for this run arrives", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);

    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    fireSSE({ type: "run:state-changed", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);

    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    fireSSE({ type: "run:state-changed", runId: "run-other" });

    // Give any (incorrect) async refetch a chance to happen, then assert it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("re-fetches with the new runId when the runId prop changes", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);

    const { rerender } = renderHook(({ runId }: { runId: string }) => useRun(runId), {
      initialProps: { runId: "run-1" },
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-1"));

    rerender({ runId: "run-2" });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-2"));
  });
});
