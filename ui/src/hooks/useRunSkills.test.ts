import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({ api: { getRunSkills: vi.fn() } }));

let sseCallback: ((e: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (e: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";

const getRunSkills = api.getRunSkills as unknown as ReturnType<typeof vi.fn>;
const skills = { injectedSkills: [], distillationDecision: null, distilledSkill: null };

beforeEach(() => {
  getRunSkills.mockReset();
  sseCallback = null;
});

describe("useRunSkills", () => {
  it("loads skills for the run", async () => {
    getRunSkills.mockResolvedValue(skills);
    const { result } = renderHook(() => useRunSkills("r1"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(skills);
    expect(getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("reports Error and non-Error failures", async () => {
    getRunSkills.mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(42);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.error).toBe("down"));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on state-change and artifact events for the same run only", async () => {
    getRunSkills.mockResolvedValue(skills);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(getRunSkills).toHaveBeenCalledTimes(1));

    act(() => sseCallback!({ type: "run:state-changed", runId: "r2" }));
    act(() => sseCallback!({ type: "process:output", runId: "r1", chunk: "x" }));
    expect(getRunSkills).toHaveBeenCalledTimes(1);

    act(() => sseCallback!({ type: "run:state-changed", runId: "r1" }));
    await waitFor(() => expect(getRunSkills).toHaveBeenCalledTimes(2));
    act(() => sseCallback!({ type: "run:artifact-created", runId: "r1" }));
    await waitFor(() => expect(getRunSkills).toHaveBeenCalledTimes(3));
  });
});
