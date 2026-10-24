import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

const sseCallbacks: Array<(event: DashboardEvent) => void> = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallbacks.push(cb);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getRunSkills: vi.fn() },
}));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks.length = 0;
  });

  it("fetches skills for the given run on mount", async () => {
    const data = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    mockApi.getRunSkills.mockResolvedValue(data);

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
    expect(result.current.data).toEqual(data);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a relevant SSE event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallbacks[0]!({ type: "run:artifact-created", runId: "r1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));

    await act(async () => {
      sseCallbacks[0]!({ type: "run:state-changed", runId: "r1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(3));
  });

  it("ignores events for a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      sseCallbacks[0]!({ type: "run:artifact-created", runId: "other" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores irrelevant event types for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      sseCallbacks[0]!({ type: "process:output", runId: "r1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
