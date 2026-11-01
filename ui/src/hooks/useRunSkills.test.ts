import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE";

vi.mock("@/api/client.ts", () => ({
  api: { getRunSkills: vi.fn() },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

import { useRunSkills } from "./useRunSkills";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const SKILLS = { injectedSkills: [], distillationDecision: null, distilledSkill: null };

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("fetches run skills for the given id", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS);
    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(SKILLS);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an Error's message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server down");
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    mockApi.getRunSkills.mockRejectedValue("oops");
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on run:artifact-created for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler?.({ type: "run:artifact-created", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "other" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types for the same runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler?.({ type: "process:started", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a manual refetch function", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });
});
