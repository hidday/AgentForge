import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

const sseCallback: { current: ((event: DashboardEvent) => void) | null } = { current: null };
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback.current = cb;
  },
}));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

function makeSkillsResponse(): RunSkillsResponse {
  return { injectedSkills: [], distillationDecision: null, distilledSkill: null };
}

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback.current = null;
  });

  it("fetches skills for the run and exposes them once loaded", async () => {
    const response = makeSkillsResponse();
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error message when the fetch rejects", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce("nope");
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed and run:artifact-created SSE events for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeSkillsResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    act(() => sseCallback.current!({ type: "run:artifact-created", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));

    act(() => sseCallback.current!({ type: "run:state-changed", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(3));
  });

  it("ignores SSE events for a different run and events of an unrelated type", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeSkillsResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => sseCallback.current!({ type: "run:state-changed", runId: "other" }));
    act(() => sseCallback.current!({ type: "run:created", runId: "run-1" }));

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a working refetch function", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeSkillsResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });
});
