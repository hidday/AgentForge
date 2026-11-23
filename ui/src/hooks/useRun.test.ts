import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeRunDetail(runId: string): { run: Run; artifacts: Artifact[]; events: RunEventRecord[] } {
  return {
    run: { id: runId } as Run,
    artifacts: [],
    events: [],
  };
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state with no data", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run on mount and exposes the result", async () => {
    const detail = makeRunDetail("run-1");
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("surfaces an Error message on failure", async () => {
    mockApi.getRun.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("not an error object");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes the API", async () => {
    const detail = makeRunDetail("run-1");
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when an SSE event for the same run arrives", async () => {
    const detail = makeRunDetail("run-1");
    mockApi.getRun.mockResolvedValue(detail);

    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    await act(async () => {
      handler({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run", async () => {
    const detail = makeRunDetail("run-1");
    mockApi.getRun.mockResolvedValue(detail);

    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "some-other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
