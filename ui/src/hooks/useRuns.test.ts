import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "li1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with no runs and no error", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("resolves with the fetched runs and clears loading", async () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" })];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("sets an error message and clears loading when the request fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRuns.mockRejectedValue("some string failure");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newRuns = [makeRun({ id: "r-new" })];
    mockApi.getRuns.mockResolvedValue({ runs: newRuns });

    act(() => {
      sseCallback!({ type: "run:created", runId: "r-new" });
    });

    await waitFor(() => expect(result.current.runs).toEqual(newRuns));
  });

  it("updates the matching run's state in place on run:state-changed", async () => {
    const runs = [makeRun({ id: "r1", state: "Planning" }), makeRun({ id: "r2", state: "Todo" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    expect(result.current.runs.find((r) => r.id === "r1")?.state).toBe("Implementing");
    expect(result.current.runs.find((r) => r.id === "r2")?.state).toBe("Todo");
    // Should not have triggered a refetch call beyond the initial one.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it doesn't care about", async () => {
    const runs = [makeRun({ id: "r1", state: "Planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    mockApi.getRuns.mockClear();
    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "x" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual(runs);
  });

  it("refetch() can be called manually", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
