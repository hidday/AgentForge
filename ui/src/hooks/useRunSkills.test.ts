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
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

const response = { injectedSkills: [], distillationDecision: null, distilledSkill: null };

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("loads skills for the given runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("no skills"));
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("no skills");
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("nope");
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() calls api.getRunSkills again", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    fireSSE({ type: "run:state-changed", runId: "run-other" });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("refetches on run:state-changed for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    fireSSE({ type: "run:state-changed", runId: "run-1" });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("refetches on run:artifact-created for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    fireSSE({ type: "run:artifact-created", runId: "run-1" });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("ignores other SSE event types for this runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    fireSSE({ type: "run:created", runId: "run-1" });
    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });
});
