import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRun } from "./useRun.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

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

const runDetail = {
  run: { id: "run-1", state: "Implementing" },
  artifacts: [{ id: "artifact-1" }],
  events: [{ id: "event-1" }],
} as any;

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in a loading state with no data or error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads the run successfully and exposes the resolved data", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("surfaces the Error message when the fetch fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run not found"));
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("re-requests the run when refetch is called", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Done" } };
    mockApi.getRun.mockClear();
    mockApi.getRun.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(updated);
  });

  it("refetches when an SSE event for the same run arrives", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "run:state-changed", runId: "run-1" }),
      });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events belonging to a different run", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "run:state-changed", runId: "other-run" }),
      });
    });

    // Give any stray async work a chance to run before asserting nothing happened.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("closes the SSE connection when the hook unmounts", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { unmount } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });
});
