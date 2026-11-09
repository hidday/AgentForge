import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const skillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading and null data, then resolves with the fetched skills", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);

    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(skillsResponse);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("server error"));

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server error");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...skillsResponse, distilledSkill: { id: "s1" } };
    mockApi.getRunSkills.mockResolvedValueOnce(updated);

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("refetches on a run:artifact-created SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...skillsResponse, distilledSkill: { id: "s2" } };
    mockApi.getRunSkills.mockResolvedValueOnce(updated);

    act(() => {
      sseHandler!({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("does not refetch for an unrelated event type on the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });
});
