import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

const RUN_ID = "run-1";

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading with null data and no error", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills(RUN_ID));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("populates data after a successful fetch", async () => {
    const payload = {
      injectedSkills: [{ id: "s1" }],
      distillationDecision: null,
      distilledSkill: null,
    };
    mockApi.getRunSkills.mockResolvedValue(payload);

    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith(RUN_ID);
  });

  it("sets an error message and stops loading when the fetch rejects with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error instance", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");

    const { result } = renderHook(() => useRunSkills(RUN_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-invokes api.getRunSkills and updates data", async () => {
    mockApi.getRunSkills.mockResolvedValueOnce({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = {
      injectedSkills: [{ id: "s2" }],
      distillationDecision: null,
      distilledSkill: null,
    };
    mockApi.getRunSkills.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(updated);
  });

  it.each(["run:state-changed", "run:artifact-created"] as const)(
    "refetches on a '%s' SSE event for the same runId",
    async (eventType) => {
      mockApi.getRunSkills.mockResolvedValue({
        injectedSkills: [],
        distillationDecision: null,
        distilledSkill: null,
      });
      const { result } = renderHook(() => useRunSkills(RUN_ID));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const updated = {
        injectedSkills: [{ id: "new" }],
        distillationDecision: null,
        distilledSkill: null,
      };
      mockApi.getRunSkills.mockResolvedValueOnce(updated);

      await act(async () => {
        sseHandler!({ type: eventType, runId: RUN_ID });
      });

      await waitFor(() => expect(result.current.data).toEqual(updated));
    },
  );

  it("does not refetch for an SSE event of a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("does not refetch for an unrelated SSE event type on the same runId", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });
    const { result } = renderHook(() => useRunSkills(RUN_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    act(() => {
      sseHandler!({ type: "process:started", runId: RUN_ID });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
