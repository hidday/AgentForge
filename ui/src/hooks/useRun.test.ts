import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import { useRun } from "./useRun";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

const RUN_DETAIL = {
  run: { id: "run-1", state: "Todo" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading and fetches the run by id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(result.current.error).toBeNull();
  });

  it("sets error to the Error's message on failure and leaves data null", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("missing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error throw", async () => {
    mockApi.getRun.mockRejectedValue("oops");
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when the id prop changes", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { rerender } = renderHook(({ id }: { id: string }) => useRun(id), {
      initialProps: { id: "run-1" },
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-1"));

    rerender({ id: "run-2" });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-2"));
  });

  it("refetches on any SSE event matching the run id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:artifact-created", runId: "other-run" });
    });

    // Give any (incorrect) async refetch a chance to happen, then assert it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("exposes a manual refetch that re-fetches the run", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });
});
