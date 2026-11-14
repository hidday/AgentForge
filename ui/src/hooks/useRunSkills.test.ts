import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills.ts";
import type { DashboardEvent } from "./useSSE.ts";

const sseHandlers: ((event: DashboardEvent) => void)[] = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandlers.push(handler);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getRunSkills: vi.fn() },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

describe("useRunSkills", () => {
  beforeEach(() => {
    sseHandlers.length = 0;
    vi.clearAllMocks();
  });

  it("fetches skills for the run on mount", async () => {
    const response = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(response);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch fails", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
  });

  it("falls back to a generic error message for a non-Error throw", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed and run:artifact-created for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      sseHandlers[0]({ type: "run:state-changed", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandlers[0]({ type: "run:artifact-created", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores events for a different run or of an unrelated type", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      sseHandlers[0]({ type: "run:state-changed", runId: "run-2" });
      sseHandlers[0]({ type: "run:created", runId: "run-1" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });
});
