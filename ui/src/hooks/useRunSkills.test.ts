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

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const RUN_ID = "run-1";
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

  it("starts loading with no data and no error", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches skills on mount and exposes the result", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRunSkills).toHaveBeenCalledWith(RUN_ID);
    expect(result.current.data).toEqual(skillsResponse);
  });

  it("sets the Error message on rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue({ some: "object" });
    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a matching run:state-changed SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: RUN_ID });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a matching run:artifact-created SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:artifact-created", runId: RUN_ID });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("does not refetch for an unrelated event type on the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "process:started", runId: RUN_ID });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("does not refetch for a matching event type on a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "other-run" });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
