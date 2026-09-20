import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";
import type { RunSkillsResponse } from "@/api/client.ts";

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
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const emptyResponse: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading with null data and no error", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads skills data on success", async () => {
    mockApi.getRunSkills.mockResolvedValue(emptyResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(emptyResponse);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("surfaces an Error's message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    mockApi.getRunSkills.mockRejectedValue("oops");

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed SSE events for the matching run", async () => {
    mockApi.getRunSkills.mockResolvedValue(emptyResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on run:artifact-created SSE events for the matching run", async () => {
    mockApi.getRunSkills.mockResolvedValue(emptyResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:artifact-created", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(emptyResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "other-run" });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(emptyResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "process:started", runId: "run-1" });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a manual refetch function", async () => {
    mockApi.getRunSkills.mockResolvedValue(emptyResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated: RunSkillsResponse = {
      ...emptyResponse,
      injectedSkills: [
        {
          id: "skill-1",
          repoSlug: "org/repo",
          name: "Skill A",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "# md",
          utilityScore: 1,
          lastUsedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    };
    mockApi.getRunSkills.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
  });
});
