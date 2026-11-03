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

import { useRunSkills } from "./useRunSkills";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

const SKILLS_RESPONSE = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading, then resolves with the skills data", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);

    const { result } = renderHook(() => useRunSkills("r1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(SKILLS_RESPONSE);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("server exploded"));
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server exploded");
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(42);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-requests the skills and clears a previous error on success", async () => {
    mockApi.getRunSkills.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRunSkills.mockResolvedValueOnce(SKILLS_RESPONSE);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(SKILLS_RESPONSE);
  });

  it("re-fetches on a matching 'run:state-changed' SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    await act(async () => {
      handler({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("re-fetches on a matching 'run:artifact-created' SSE event", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    await act(async () => {
      handler({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores an unrelated event type for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    act(() => {
      handler({ type: "run:created", runId: "r1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
