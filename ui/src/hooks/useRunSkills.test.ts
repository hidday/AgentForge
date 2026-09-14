import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

const sseCallbacks: Array<(event: DashboardEvent) => void> = [];
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallbacks.push(cb);
  },
}));

import { api } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const RESPONSE: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

function latestSSECallback() {
  return sseCallbacks[sseCallbacks.length - 1]!;
}

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks.length = 0;
  });

  it("starts loading and fetches skills for the given run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(RESPONSE);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an Error's message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    mockApi.getRunSkills.mockRejectedValue("nope");
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-invokes api.getRunSkills for the same id", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      latestSSECallback()({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("ignores SSE event types other than state-changed / artifact-created", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      latestSSECallback()({ type: "run:created", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("refetches on a run:state-changed SSE event for the same run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      latestSSECallback()({ type: "run:state-changed", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1"));
  });

  it("refetches on a run:artifact-created SSE event for the same run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      latestSSECallback()({ type: "run:artifact-created", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1"));
  });
});
