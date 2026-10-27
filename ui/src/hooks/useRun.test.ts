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

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function getRegisteredHandler() {
  return mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1][0] as (event: {
    type: string;
    runId: string;
    [k: string]: unknown;
  }) => void;
}

const RUN_DETAIL = {
  run: { id: "r1", state: "Planning" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading, then resolves with the run detail payload", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);

    const { result } = renderHook(() => useRun("r1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets the Error's message on failure", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("missing"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue("boom");

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("re-fetches when runId changes", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { rerender } = renderHook(({ id }) => useRun(id), { initialProps: { id: "r1" } });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("r1"));

    rerender({ id: "r2" });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("r2"));
  });

  it("refetch() invokes api.getRun again", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("refetches on any SSE event matching this run's id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:artifact-created", runId: "other-run" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });
});
