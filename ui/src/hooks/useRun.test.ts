import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEventSource.instances.push(this);
  }
}

function emit(source: FakeEventSource, event: Record<string, unknown>) {
  act(() => {
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
  });
}

const RUN_DETAIL = { run: { id: "run-1", state: "Planning" }, artifacts: [], events: [] };

describe("useRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts loading, then resolves with the run detail for the given id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message on fetch failure", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when the runId prop changes", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { rerender } = renderHook(({ id }) => useRun(id), { initialProps: { id: "run-1" } });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-1"));

    rerender({ id: "run-2" });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-2"));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("refetches on any SSE event for the same run", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { run: { id: "run-1", state: "Done" }, artifacts: [], events: [] };
    mockApi.getRun.mockResolvedValueOnce(updated);

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:state-changed", runId: "run-1" });

    await waitFor(() => expect(result.current.data).toEqual(updated));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:state-changed", runId: "run-2" });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("exposes refetch for manual reloads", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockResolvedValueOnce({ ...RUN_DETAIL, artifacts: [{ id: "a1" }] } as never);
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data?.artifacts).toEqual([{ id: "a1" }]);
  });
});
