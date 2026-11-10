import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import { useRunSkills } from "./useRunSkills";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

const SKILLS_RESPONSE = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading and fetches skills for the given run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(SKILLS_RESPONSE);
    expect(result.current.error).toBeNull();
  });

  it("sets error to the Error's message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error throw", async () => {
    mockApi.getRunSkills.mockRejectedValue(42);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a matching 'run:state-changed' SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a matching 'run:artifact-created' SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for other run ids", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "other-run" });
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it does not act on, even for the matching run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:output", runId: "run-1" });
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a manual refetch", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });
});
