import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills";
import { api, type RunSkillsResponse } from "@/api/client.ts";
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

const response: RunSkillsResponse = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.mocked(api.getRunSkills).mockReset();
    sseHandler = null;
  });

  it("loads run skills on mount", async () => {
    vi.mocked(api.getRunSkills).mockResolvedValue(response);
    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(response);
    expect(api.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("surfaces an error message when the fetch fails", async () => {
    vi.mocked(api.getRunSkills).mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("nope");
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    vi.mocked(api.getRunSkills).mockRejectedValue("bad");
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed for this run", async () => {
    vi.mocked(api.getRunSkills).mockResolvedValue(response);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(api.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1" });
    });
    await waitFor(() => expect(api.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on run:artifact-created for this run", async () => {
    vi.mocked(api.getRunSkills).mockResolvedValue(response);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(api.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "run:artifact-created", runId: "r1" });
    });
    await waitFor(() => expect(api.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores events for other runs", async () => {
    vi.mocked(api.getRunSkills).mockResolvedValue(response);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(api.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other" });
    });
    expect(api.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated event types for this run", async () => {
    vi.mocked(api.getRunSkills).mockResolvedValue(response);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(api.getRunSkills).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });
    expect(api.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
