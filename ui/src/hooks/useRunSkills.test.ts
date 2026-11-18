import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const skillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

function fireSSE(event: DashboardEvent) {
  act(() => {
    sseCallback?.(event);
  });
}

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches skills for the run and transitions out of loading", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(skillsResponse);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch rejects", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("server error"));
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server error");
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("oops");
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("re-fetches on run:state-changed for the same runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "run-1" });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("re-fetches on run:artifact-created for the same runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:artifact-created", runId: "run-1" });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "run-2" });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it does not care about, even for the same runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:created", runId: "run-1" });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });
});
