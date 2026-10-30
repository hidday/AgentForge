import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: { getRun: vi.fn() },
}));

vi.mock("./useSSE.ts", () => ({ useSSE: vi.fn() }));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeRunDetail(): { run: Run; artifacts: Artifact[]; events: RunEventRecord[] } {
  return {
    run: { id: "run-1" } as Run,
    artifacts: [],
    events: [],
  };
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading and fetches run data on mount", async () => {
    const detail = makeRunDetail();
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue("some string failure");
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch triggers another call to api.getRun", async () => {
    const detail = makeRunDetail();
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockApi.getRun.mockClear();

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("re-fetches on an SSE event for the same run and ignores events for other runs", async () => {
    const detail = makeRunDetail();
    mockApi.getRun.mockResolvedValue(detail);
    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const handleSSE = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;

    act(() => {
      handleSSE({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      handleSSE({ type: "run:state-changed", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });
});
