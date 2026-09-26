import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const run = { id: "run-1", state: "Planning" } as Run;
const runDetail = { run, artifacts: [], events: [] };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading with null data and no error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run by id on mount", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(runDetail);
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message on fetch failure and leaves data null", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run not found"));
    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("run not found");
    expect(result.current.data).toBeNull();
  });

  it("sets a generic error message when the rejection isn't an Error", async () => {
    mockApi.getRun.mockRejectedValue("oops");
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes api.getRun", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      sseHandler?.({ type: "run:state-changed", runId: "run-1" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "some-other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
