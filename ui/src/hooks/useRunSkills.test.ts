import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
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

  it("fetches skills for the given runId on mount", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(skillsResponse);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("surfaces an error message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce(42);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback?.({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("refetches on run:state-changed for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);
    act(() => {
      sseCallback?.({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on run:artifact-created for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);
    act(() => {
      sseCallback?.({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("does not refetch on unrelated SSE event types for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(skillsResponse);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback?.({ type: "process:started", runId: "run-1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
