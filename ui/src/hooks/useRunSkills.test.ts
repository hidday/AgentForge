import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: { getRunSkills: vi.fn() },
}));
vi.mock("./useSSE.ts", () => ({ useSSE: vi.fn() }));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeResponse(): RunSkillsResponse {
  return { injectedSkills: [], distillationDecision: null, distilledSkill: null };
}

describe("useRunSkills", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches skills on mount and exposes the result", async () => {
    const resp = makeResponse();
    mockApi.getRunSkills.mockResolvedValue(resp);
    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(resp);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets a message from an Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.error).toBe("nope"));
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce("stringy failure");
    const { result } = renderHook(() => useRunSkills("run-2"));
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch run skills"));
  });

  it("refetches on matching SSE event types and ignores others or other runs", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handleSSE = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;

    act(() => {
      handleSSE({ type: "run:created", runId: "run-1" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    act(() => {
      handleSSE({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      handleSSE({ type: "run:state-changed", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));

    await act(async () => {
      handleSSE({ type: "run:artifact-created", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(3));
  });
});
