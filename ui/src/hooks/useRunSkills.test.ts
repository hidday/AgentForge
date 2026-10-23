import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const RESPONSE: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading with null data", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("populates data on a successful fetch", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(RESPONSE);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("server exploded"));
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server exploded");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue(42);
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed for the matching runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    await act(async () => {
      sseHandler!({ type: "run:state-changed", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("refetches on run:artifact-created for the matching runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    await act(async () => {
      sseHandler!({ type: "run:artifact-created", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("does not refetch for an unrelated event type on the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "run:created", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("does not refetch for a matching event type on a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
