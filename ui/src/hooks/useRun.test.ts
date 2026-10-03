import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("./useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("./useSSE.ts")>("./useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN_ID = "run-1";
const runDetail = {
  run: { id: RUN_ID, state: "Implementing" },
  artifacts: [{ id: "a1" }],
  events: [{ id: "e1" }],
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with no data and no error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun(RUN_ID));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run on mount and exposes the result", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
  });

  it("sets a message from an Error rejection and leaves data null", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run missing"));
    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("run missing");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("some string failure");
    const { result } = renderHook(() => useRun(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes the API and updates data again", async () => {
    mockApi.getRun.mockResolvedValueOnce(runDetail);
    const { result } = renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Done" } };
    mockApi.getRun.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(updated);
  });

  it("refetches when an SSE event for this run arrives", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: RUN_ID });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "some-other-run" });

    // Give any (incorrect) async refetch a chance to happen, then assert it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
