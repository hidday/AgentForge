import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state with no data and no error", async () => {
    let resolveRun!: (v: unknown) => void;
    mockApi.getRun.mockReturnValue(new Promise((res) => (resolveRun = res)));

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    act(() => resolveRun({ run: { id: "run-1" }, artifacts: [], events: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("fetches the run on mount and exposes run, artifacts and events", async () => {
    const payload = {
      run: { id: "run-1", state: "running" },
      artifacts: [{ id: "a1" }],
      events: [{ id: "e1" }],
    };
    mockApi.getRun.mockResolvedValue(payload);

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message and clears loading when the fetch rejects", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-requests the run and clears a previous error on success", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.error).toBe("first failure"));

    const payload = { run: { id: "run-1" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValueOnce(payload);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(payload);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "run-1" }, artifacts: [], events: [] });
    renderHook(() => useRun("run-1"));

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => {
      latestHandler()({ type: "run:state-changed", runId: "other-run" });
    });

    // No extra fetch triggered for an unrelated run.
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("refetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "run-1" }, artifacts: [], events: [] });
    renderHook(() => useRun("run-1"));

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => {
      latestHandler()({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });
});
