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

const RESPONSE: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts loading with null data", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("loads skill data successfully, scoped to the given runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(RESPONSE);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("surfaces the Error message on fetch failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("no skills"));
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("no skills");
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a matching run:state-changed SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("refetches on a matching run:artifact-created SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      capturedHandler!({ type: "run:artifact-created", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("ignores SSE event types it doesn't care about, even for a matching runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      capturedHandler!({ type: "run:created", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });
});
