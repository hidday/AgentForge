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

  it("starts in a loading state with null data and no error", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves with the skills response and clears loading", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(RESPONSE);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and clears loading when the request fails", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValue("oops");
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed SSE event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated: RunSkillsResponse = { ...RESPONSE, distilledSkill: null };
    mockApi.getRunSkills.mockClear();
    mockApi.getRunSkills.mockResolvedValue(updated);

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("refetches on a run:artifact-created SSE event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      sseCallback!({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("ignores SSE event types it doesn't care about for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      sseCallback!({ type: "run:created", runId: "r1" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("refetch() can be called manually", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
