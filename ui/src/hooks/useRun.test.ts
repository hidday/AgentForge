import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun.ts";
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

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const runDetail = {
  run: { id: "r1", state: "Executing" },
  artifacts: [{ id: "a1" }],
  events: [{ id: "e1" }],
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with no data", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads run data successfully", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch rejects", async () => {
    mockApi.getRun.mockRejectedValue(new Error("Run not found"));
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for the same run arrives", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Reviewing" } };
    mockApi.getRun.mockResolvedValue(updated);

    fireSSE({ type: "run:state-changed", runId: "r1" });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "other-run" });

    // Give any potential async refetch a chance to run, then assert it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("exposes a manual refetch function", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });
});
