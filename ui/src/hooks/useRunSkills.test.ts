import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const response: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts in a loading state with null data and no error", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches run skills on mount and transitions to loaded state", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("Skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRunSkills.mockRejectedValue(42);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-invokes the API and updates data", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce(response);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated: RunSkillsResponse = {
      injectedSkills: [
        {
          id: "s1",
          repoSlug: "org/repo",
          name: "skill-1",
          description: "desc",
          taskCategory: "cat",
          skillMarkdown: "# md",
          utilityScore: 1,
          lastUsedAt: "2024-01-01T00:00:00Z",
        },
      ],
      distillationDecision: null,
      distilledSkill: null,
    };
    mockApi.getRunSkills.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("refetches on a matching run:state-changed SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);

    renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    expect(capturedHandler).not.toBeNull();
    await act(async () => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a matching run:artifact-created SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);

    renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    await act(async () => {
      capturedHandler!({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);

    renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types that are not state-changed or artifact-created", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);

    renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      capturedHandler!({ type: "run:created", runId: "run-1" });
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
