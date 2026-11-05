import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

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

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

const SKILLS_RESPONSE = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

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

  it("populates data on success", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(SKILLS_RESPONSE);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("surfaces the error message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-queries the API", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("refetches on run:state-changed SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    fireSSE({ type: "run:state-changed", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on run:artifact-created SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    fireSSE({ type: "run:artifact-created", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    fireSSE({ type: "run:state-changed", runId: "run-other" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated SSE event types for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    fireSSE({ type: "process:started", runId: "run-1" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
