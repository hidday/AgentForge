import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const skillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading with null data, then resolves with skills data", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(skillsResponse);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets error message on rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.error).toBe("skills unavailable"));
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue({});
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch run skills"));
  });

  it("refetch() calls api.getRunSkills again", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockResolvedValueOnce({ ...skillsResponse, distilledSkill: null });
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("refetches on a run:state-changed event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "r1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a run:artifact-created event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      sseCallback!({ type: "run:artifact-created", runId: "r1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores events for a different run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated event types for the same run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:created", runId: "r1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
