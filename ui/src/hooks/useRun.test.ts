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

const runDetail = {
  run: { id: "r1", state: "Planning" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading and fetches the run on mount", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and clears loading when the fetch rejects", async () => {
    mockApi.getRun.mockRejectedValue(new Error("Run not found"));
    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for this run arrives", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    mockApi.getRun.mockResolvedValue({ ...runDetail, run: { ...runDetail.run, state: "Implementing" } });

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data?.run.state).toBe("Implementing"));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });

  it("exposes a refetch function that re-runs the fetch", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });
});
