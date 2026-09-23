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

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => sseCallback!(event));
}

const runDetail = {
  run: { id: "r1", state: "Todo" },
  artifacts: [],
  events: [],
} as never;

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading and then resolves with run detail data", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(runDetail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("r1"));

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

  it("refetch() re-invokes api.getRun", async () => {
    mockApi.getRun.mockResolvedValueOnce(runDetail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Done" } };
    mockApi.getRun.mockResolvedValueOnce(updated);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("refetches on an SSE event matching this run's id", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...runDetail, run: { ...runDetail.run, state: "Planning" } };
    mockApi.getRun.mockResolvedValueOnce(updated);
    fireSSE({ type: "run:state-changed", runId: "r1" });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("ignores an SSE event for a different run id", async () => {
    mockApi.getRun.mockResolvedValue(runDetail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    fireSSE({ type: "run:state-changed", runId: "some-other-run" });

    expect(mockApi.getRun).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(runDetail);
  });
});
