import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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

function getRegisteredHandler() {
  return mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1][0] as (event: {
    type: string;
    runId: string;
    [k: string]: unknown;
  }) => void;
}

const SKILLS_RESPONSE = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads skills data for the given run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    const { result } = renderHook(() => useRunSkills("r1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(SKILLS_RESPONSE);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets the Error's message on failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(42);

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on 'run:state-changed' events for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("refetches on 'run:artifact-created' events for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("ignores events for a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("ignores unrelated event types for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "run:created", runId: "r1" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("refetch() invokes api.getRunSkills again", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
