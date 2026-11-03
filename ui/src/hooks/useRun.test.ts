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

import { useRun } from "./useRun";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

const RUN_DETAIL = {
  run: { id: "r1", state: "Planning" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading, then resolves with the run detail", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);

    const { result } = renderHook(() => useRun("r1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

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

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue("oops");
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-requests the run and clears a previous error on success", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRun.mockResolvedValueOnce(RUN_DETAIL);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(RUN_DETAIL);
  });

  it("re-fetches on an SSE event for the matching runId", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    renderHook(() => useRun("r1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    await act(async () => {
      handler({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores an SSE event for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    renderHook(() => useRun("r1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
