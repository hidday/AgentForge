import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestSSEHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

const skillsResponse: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading and resolves with skills data", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(skillsResponse);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch fails with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("server exploded"));
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server exploded");
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    const updated = { ...skillsResponse, injectedSkills: [] };
    mockApi.getRunSkills.mockResolvedValue(updated);

    await act(async () => {
      latestSSEHandler()({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalled());
  });

  it("refetches on a run:artifact-created SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      latestSSEHandler()({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalled());
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      latestSSEHandler()({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("ignores SSE event types other than state-changed / artifact-created for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      latestSSEHandler()({ type: "run:created", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });
});
