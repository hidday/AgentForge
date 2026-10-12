import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

const sseHandlers: Array<(event: unknown) => void> = [];
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: unknown) => void) => {
    sseHandlers.push(handler);
  },
}));

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandlers.length = 0;
  });

  it("starts in a loading state with no data", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads run detail successfully", async () => {
    const detail = { run: { id: "r1" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch fails with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run not found"));

    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("oops");

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for the same run arrives", async () => {
    const detail = { run: { id: "r1", state: "Planning" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { run: { id: "r1", state: "Executing" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(updated);

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different run", async () => {
    const detail = { run: { id: "r1", state: "Planning" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(detail);
  });

  it("exposes a refetch function that re-fetches the run", async () => {
    const detail = { run: { id: "r1", state: "Planning" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { run: { id: "r1", state: "Done" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
  });

  it("refetches when the runId prop changes", async () => {
    mockApi.getRun.mockResolvedValue({ run: { id: "r1" }, artifacts: [], events: [] });

    const { rerender } = renderHook(({ runId }) => useRun(runId), {
      initialProps: { runId: "r1" },
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("r1"));

    mockApi.getRun.mockResolvedValue({ run: { id: "r2" }, artifacts: [], events: [] });
    rerender({ runId: "r2" });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("r2"));
  });
});
