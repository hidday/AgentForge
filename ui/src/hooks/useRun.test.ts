import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor() {
    MockEventSource.instances.push(this);
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const RUN_DETAIL = {
  run: { id: "r1", state: "Todo" },
  artifacts: [],
  events: [],
};

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with loading true and null data", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("r1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run by id and populates data on success", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(RUN_DETAIL);
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and stops loading when the fetch rejects", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when the runId changes", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { rerender } = renderHook(({ id }) => useRun(id), {
      initialProps: { id: "r1" },
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("r1"));

    rerender({ id: "r2" });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("r2"));
  });

  it("clears a previous error on a subsequent successful refetch", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    mockApi.getRun.mockResolvedValueOnce(RUN_DETAIL);

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(RUN_DETAIL);
  });

  it("refetches on any SSE event matching this run's id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRun.mockResolvedValue(RUN_DETAIL);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "run:artifact-created", runId: "other" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });
});
