import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseCallback: ((event: unknown) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: unknown) => void) => {
    sseCallback = cb;
  }),
}));

import { useRun } from "./useRun";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN_DETAIL = {
  run: { id: "r1", state: "Todo" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches the run detail on mount and clears loading", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);

    const { result } = renderHook(() => useRun("r1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
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

  it("refetches when runId changes", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result, rerender } = renderHook(({ id }) => useRun(id), {
      initialProps: { id: "r1" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    mockApi.getRun.mockResolvedValue({ ...RUN_DETAIL, run: { id: "r2", state: "Done" } });

    rerender({ id: "r2" });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("r2"));
  });

  it("refetch() re-invokes api.getRun", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("re-fetches on an SSE event matching this runId", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    mockApi.getRun.mockResolvedValue({ ...RUN_DETAIL, run: { id: "r1", state: "Planning" } });

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "r1" });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.data?.run.state).toBe("Planning"),
    );
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });
});
