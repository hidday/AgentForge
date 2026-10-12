import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

const sseHandlers: Array<(event: unknown) => void> = [];
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: unknown) => void) => {
    sseHandlers.push(handler);
  },
}));

import { api } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandlers.length = 0;
  });

  it("starts in a loading state with no data", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRunSkills("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads run skills successfully", async () => {
    const payload = {
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    };
    mockApi.getRunSkills.mockResolvedValue(payload);

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message when the fetch fails with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("oops");

    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = {
      injectedSkills: [{ id: "s1" }],
      distillationDecision: null,
      distilledSkill: null,
    };
    mockApi.getRunSkills.mockResolvedValue(updated);

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("refetches on a run:artifact-created event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = {
      injectedSkills: [{ id: "s2" }],
      distillationDecision: null,
      distilledSkill: null,
    };
    mockApi.getRunSkills.mockResolvedValue(updated);

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(result.current.data).toEqual(updated));
  });

  it("ignores events for a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated event types for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({ type: "process:started", runId: "r1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = {
      injectedSkills: [{ id: "s3" }],
      distillationDecision: null,
      distilledSkill: null,
    };
    mockApi.getRunSkills.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
  });
});
