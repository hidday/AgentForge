import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
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

import { useRunSkills } from "./useRunSkills";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const RESPONSE: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading and fetches skills on mount", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(RESPONSE);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("oops");
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-requests the skills and clears a previous error", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRunSkills.mockResolvedValueOnce(RESPONSE);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(RESPONSE);
  });

  it("refetches on a run:state-changed SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a run:artifact-created SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores an SSE event for a different run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run", to: "Done" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores an SSE event type it doesn't care about, even for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "run:created", runId: "r1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
