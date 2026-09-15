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

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeRunDetail(id: string): { run: Run; artifacts: Artifact[]; events: RunEventRecord[] } {
  return {
    run: { id } as unknown as Run,
    artifacts: [],
    events: [],
  };
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state with no data and no error", async () => {
    let resolveFn!: (v: ReturnType<typeof makeRunDetail>) => void;
    mockApi.getRun.mockReturnValue(new Promise((res) => (resolveFn = res)));

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    act(() => resolveFn(makeRunDetail("run-1")));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("populates data and clears error on a successful fetch", async () => {
    const detail = makeRunDetail("run-1");
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets a fallback error message when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("sets a generic fallback error message when the fetch rejects with a non-Error value", async () => {
    mockApi.getRun.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch re-invokes api.getRun", async () => {
    mockApi.getRun.mockResolvedValue(makeRunDetail("run-1"));

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("refetches via SSE only when the event's runId matches this hook's runId", async () => {
    mockApi.getRun.mockResolvedValue(makeRunDetail("run-1"));

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    // Grab the handler registered with useSSE.
    const handler = mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
      e: DashboardEvent,
    ) => void;

    act(() => handler({ type: "run:state-changed", runId: "other-run" }));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => handler({ type: "run:state-changed", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });
});
