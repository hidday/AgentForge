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

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("fetches skills on mount", async () => {
    const response = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.error).toBe("skills unavailable"));
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch run skills"));
  });

  it("refetches only on run:state-changed or run:artifact-created events for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    // Different run: ignored.
    act(() => sseCallback!({ type: "run:artifact-created", runId: "other" }));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    // Same run but irrelevant event type: ignored.
    act(() => sseCallback!({ type: "run:created", runId: "run-1" }));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    // Same run, relevant event type: refetches.
    act(() => sseCallback!({ type: "run:artifact-created", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));

    act(() => sseCallback!({ type: "run:state-changed", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(3));
  });
});
