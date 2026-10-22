import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

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

function fireSSE(event: DashboardEvent) {
  act(() => {
    sseCallback!(event);
  });
}

const response = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
} as never;

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches skills for the given run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
    expect(result.current.data).toEqual(response);
  });

  it("sets an error message when the fetch fails", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("re-fetches on a matching run:state-changed event", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "r1" });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("re-fetches on a matching run:artifact-created event", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:artifact-created", runId: "r1" });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores events for a different run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    fireSSE({ type: "run:state-changed", runId: "other" });
    await Promise.resolve();
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated event types for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    fireSSE({ type: "process:started", runId: "r1" });
    await Promise.resolve();
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
