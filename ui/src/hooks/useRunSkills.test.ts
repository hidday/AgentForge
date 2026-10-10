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

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getRunSkills: ReturnType<typeof vi.fn>;
};

const skillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

beforeEach(() => {
  sseCallback = null;
  mockApi.getRunSkills.mockReset();
});

describe("useRunSkills", () => {
  it("fetches run skills on mount and exposes loading -> success", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(skillsResponse);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("tracks an error message when the fetch fails with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a default error message for a non-Error throw", async () => {
    mockApi.getRunSkills.mockRejectedValue(42);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch re-invokes the api call and updates data", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...skillsResponse, injectedSkills: [{ id: "s1" }] as never };
    mockApi.getRunSkills.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(updated);
  });

  it("refetches on a matching run:state-changed event", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a matching run:artifact-created event", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      sseCallback!({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores an event for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores a matching runId with an irrelevant event type", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback!({ type: "run:created", runId: "run-1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
