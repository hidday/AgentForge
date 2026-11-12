import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseHandler: ((event: unknown) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: unknown) => void) => {
    sseHandler = cb;
  }),
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const detail = {
  run: { id: "r1", state: "pending" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading with null data and no error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run for the given id and stores the result", async () => {
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message on failure", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("nope");

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch calls the API again and updates data", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...detail, run: { ...detail.run, state: "running" } };
    mockApi.getRun.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
  });

  it("refetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...detail, run: { ...detail.run, state: "reviewing" } };
    mockApi.getRun.mockResolvedValueOnce(updated);

    await act(async () => {
      sseHandler?.({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(detail);
  });
});
