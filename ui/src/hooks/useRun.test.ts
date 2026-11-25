import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN_DETAIL = {
  run: { id: "run-1", state: "planning" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading, then resolves with the run detail payload", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message on rejection with an Error instance", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("run-404"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue({ weird: true });
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() calls api.getRun again and clears a previous error on success", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRun.mockResolvedValueOnce(RUN_DETAIL);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(RUN_DETAIL);
  });

  it("refetches via SSE when the event's runId matches", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...RUN_DETAIL, run: { ...RUN_DETAIL.run, state: "executing" } };
    mockApi.getRun.mockResolvedValue(updated);

    await act(async () => {
      sseHandler!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });
});
