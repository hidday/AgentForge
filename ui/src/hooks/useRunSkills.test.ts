import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";
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
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeResponse(): RunSkillsResponse {
  return { injectedSkills: [], distillationDecision: null, distilledSkill: null };
}

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state with no data and no error", async () => {
    let resolveFn!: (v: RunSkillsResponse) => void;
    mockApi.getRunSkills.mockReturnValue(new Promise((res) => (resolveFn = res)));

    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    act(() => resolveFn(makeResponse()));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("populates data and clears error on a successful fetch", async () => {
    const response = makeResponse();
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets a fallback error message when the fetch rejects with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
  });

  it("sets a generic fallback error message when the fetch rejects with a non-Error value", async () => {
    mockApi.getRunSkills.mockRejectedValue({ weird: true });

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch re-invokes api.getRunSkills", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    const handler = mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
      e: DashboardEvent,
    ) => void;

    act(() => handler({ type: "run:state-changed", runId: "other-run" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("refetches on a matching run:state-changed event", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const handler = mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
      e: DashboardEvent,
    ) => void;

    act(() => handler({ type: "run:state-changed", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a matching run:artifact-created event", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const handler = mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
      e: DashboardEvent,
    ) => void;

    act(() => handler({ type: "run:artifact-created", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("does not refetch for a matching runId on an unrelated event type", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const handler = mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
      e: DashboardEvent,
    ) => void;

    act(() => handler({ type: "run:created", runId: "run-1" }));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });
});
