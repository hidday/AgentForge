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

import { api } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const RUN_ID = "run-1";
const skillsResponse = { injectedSkills: [], distillationDecision: null, distilledSkill: null };

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading with null data", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("fetches run skills by runId and exposes the result on success", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRunSkills).toHaveBeenCalledWith(RUN_ID);
    expect(result.current.data).toEqual(skillsResponse);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it does not care about, even for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "process:started", runId: RUN_ID });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("refetches on a run:state-changed event for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: RUN_ID });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a run:artifact-created event for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseCallback!({ type: "run:artifact-created", runId: RUN_ID });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });
});
