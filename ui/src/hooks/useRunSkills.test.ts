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
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const response: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with null data and no error", async () => {
    let resolveFetch!: (v: RunSkillsResponse) => void;
    mockApi.getRunSkills.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );

    const { result } = renderHook(() => useRunSkills("r1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveFetch(response);
    });
  });

  it("fetches by runId and updates data on success", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
    expect(result.current.data).toEqual(response);
  });

  it("sets error state on rejection with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills fetch failed"));

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills fetch failed");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when rejection is not an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue("oops");

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-invokes the API", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated: RunSkillsResponse = { ...response, distilledSkill: null };
    mockApi.getRunSkills.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("re-fetches on a run:state-changed SSE event for the matching runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("re-fetches on a run:artifact-created SSE event for the matching runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      sseCallback!({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run", to: "Done" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types for the matching runId", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
