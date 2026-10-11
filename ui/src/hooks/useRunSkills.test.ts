import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills.ts";
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

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const skillsResponse = {
  injectedSkills: [{ id: "s1" }],
  distillationDecision: null,
  distilledSkill: null,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with no data", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads skills data successfully", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(skillsResponse);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch rejects", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed events for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "r1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on run:artifact-created events for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:artifact-created", runId: "r1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events of other types for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:created", runId: "r1" });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "other" });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
