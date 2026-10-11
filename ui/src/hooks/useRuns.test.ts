import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

const run1 = { id: "r1", state: "Planning" };
const run2 = { id: "r2", state: "Executing" };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with an empty runs array", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads runs successfully with no state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual([run1, run2]);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the api call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("sets an error message when the fetch rejects", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("Server down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list when a run:created SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    fireSSE({ type: "run:created", runId: run2.id });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.runs).toEqual([run1, run2]));
  });

  it("patches run state in place on a run:state-changed SSE event without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: run1.id, to: "Reviewing" });

    await waitFor(() =>
      expect(result.current.runs).toEqual([{ ...run1, state: "Reviewing" }, run2]),
    );
    // No additional network call for an in-place state patch.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched when patching state for one run id", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "nonexistent", to: "Reviewing" });

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.runs).toEqual([run1, run2]);
  });

  it("exposes a manual refetch function", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [run1] });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });
});
