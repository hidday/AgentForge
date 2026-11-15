import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("fetches run skills on mount", async () => {
    const data = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    mockApi.getRunSkills.mockResolvedValue(data);

    const { result } = renderHook(() => useRunSkills("run-1"));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(data);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("records an error on fetch failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed event for the same run", async () => {
    mockApi.getRunSkills
      .mockResolvedValueOnce({ injectedSkills: [], distillationDecision: null, distilledSkill: null })
      .mockResolvedValueOnce({ injectedSkills: [{ id: "s1" }], distillationDecision: null, distilledSkill: null });

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a run:artifact-created event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      capturedHandler!({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      capturedHandler!({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores events of an unrelated type for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      capturedHandler!({ type: "process:started", runId: "run-1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
