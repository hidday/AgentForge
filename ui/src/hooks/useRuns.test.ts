import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function getRegisteredHandler() {
  return mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1][0] as (event: {
    type: string;
    runId: string;
    [k: string]: unknown;
  }) => void;
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state and populates runs once the fetch resolves", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Planning" }] });

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([{ id: "r1", state: "Planning" }]);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets a fallback error message when the rejection is not an Error instance", async () => {
    mockApi.getRuns.mockRejectedValue("network exploded");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
    expect(result.current.runs).toEqual([]);
  });

  it("sets the Error's message when the rejection is an Error instance", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.error).toBe("server down"));
  });

  it("refetch() re-invokes api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("refetches on a 'run:created' SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:created", runId: "irrelevant" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));
  });

  it("locally patches a run's state on a 'run:state-changed' event without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [
        { id: "r1", state: "Planning" },
        { id: "r2", state: "Planning" },
      ],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    expect(result.current.runs).toEqual([
      { id: "r1", state: "Implementing" },
      { id: "r2", state: "Planning" },
    ]);
    // Local patch only — no refetch triggered.
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores SSE event types it does not recognize", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [{ id: "r1", state: "Planning" }] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([{ id: "r1", state: "Planning" }]);
  });
});
