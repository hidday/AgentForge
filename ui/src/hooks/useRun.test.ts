import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({ api: { getRun: vi.fn() } }));

let sseCallback: ((e: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (e: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const getRun = api.getRun as unknown as ReturnType<typeof vi.fn>;
const detail = { run: { id: "r1", state: "Planning" }, artifacts: [], events: [] };

beforeEach(() => {
  getRun.mockReset();
  sseCallback = null;
});

describe("useRun", () => {
  it("starts loading then exposes fetched data", async () => {
    getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("r1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(getRun).toHaveBeenCalledWith("r1");
  });

  it("surfaces Error messages on failure", async () => {
    getRun.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("uses a generic message for non-Error rejections and clears it on refetch success", async () => {
    getRun.mockRejectedValueOnce("nope").mockResolvedValueOnce(detail);
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch run"));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(detail);
  });

  it("refetches only on SSE events for its own run", async () => {
    getRun.mockResolvedValue(detail);
    renderHook(() => useRun("r1"));
    await waitFor(() => expect(getRun).toHaveBeenCalledTimes(1));
    act(() => sseCallback!({ type: "run:state-changed", runId: "other" }));
    expect(getRun).toHaveBeenCalledTimes(1);
    act(() => sseCallback!({ type: "run:artifact-created", runId: "r1" }));
    await waitFor(() => expect(getRun).toHaveBeenCalledTimes(2));
  });
});
