import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

const runsPayload = {
  runs: [
    { id: "run-1", state: "Implementing" },
    { id: "run-2", state: "Done" },
  ],
} as any;

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in a loading state with an empty run list", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads runs successfully with no state filter", async () => {
    mockApi.getRuns.mockResolvedValue(runsPayload);
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual(runsPayload.runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("surfaces the Error message when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("re-requests runs when refetch is called", async () => {
    mockApi.getRuns.mockResolvedValue(runsPayload);
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    const updated = { runs: [{ id: "run-3", state: "Todo" }] };
    mockApi.getRuns.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual(updated.runs);
  });

  it("refetches the full list when a run:created SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValue(runsPayload);
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "run:created", runId: "run-3" }),
      });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("locally patches a run's state on run:state-changed without refetching", async () => {
    mockApi.getRuns.mockResolvedValue(runsPayload);
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "run:state-changed", runId: "run-1", to: "Done" }),
      });
    });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "run-1")?.state).toBe("Done"),
    );
    // Local patch, not a network refetch.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    // The unrelated run is left untouched.
    expect(result.current.runs.find((r) => r.id === "run-2")?.state).toBe("Done");
  });

  it("closes the SSE connection when the hook unmounts", async () => {
    mockApi.getRuns.mockResolvedValue(runsPayload);
    const { unmount } = renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
