import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills.ts";
import { api, type RunSkillsResponse } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  }),
}));

const mockedGetRunSkills = vi.mocked(api.getRunSkills);

const skillsPayload: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    sseHandler = null;
    mockedGetRunSkills.mockReset();
  });

  it("starts in a loading state with null data and no error", async () => {
    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);
    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("loads run skills successfully", async () => {
    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(skillsPayload);
    expect(result.current.error).toBeNull();
    expect(mockedGetRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockedGetRunSkills.mockRejectedValueOnce(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockedGetRunSkills.mockRejectedValueOnce(42);

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed SSE event for the same run", async () => {
    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated: RunSkillsResponse = { ...skillsPayload, distilledSkill: null };
    mockedGetRunSkills.mockResolvedValueOnce(updated);

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockedGetRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a run:artifact-created SSE event for the same run", async () => {
    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);

    act(() => {
      sseHandler!({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockedGetRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run", async () => {
    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other" });
    });

    expect(mockedGetRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types for the same run", async () => {
    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:created", runId: "r1" });
    });

    expect(mockedGetRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-runs the fetch", async () => {
    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedGetRunSkills.mockResolvedValueOnce(skillsPayload);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockedGetRunSkills).toHaveBeenCalledTimes(2);
  });
});
