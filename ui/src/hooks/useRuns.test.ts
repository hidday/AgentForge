import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRuns } from "./useRuns";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "li-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state and fetches runs for an undefined filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Planning"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("populates runs on a successful fetch", async () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
  });

  it("sets error to the Error's message on failure", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error throw", async () => {
    mockApi.getRuns.mockRejectedValue("some string failure");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("clears a prior error on a successful refetch", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun()] });
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.runs).toHaveLength(1);
  });

  it("refetches when an SSE 'run:created' event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:created", runId: "run-9" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("updates a run's state in place on an SSE 'run:state-changed' event without refetching", async () => {
    const runs = [makeRun({ id: "r1", state: "Todo" }), makeRun({ id: "r2", state: "Todo" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "r1", to: "Planning" });
    });

    expect(result.current.runs.find((r) => r.id === "r1")?.state).toBe("Planning");
    expect(result.current.runs.find((r) => r.id === "r2")?.state).toBe("Todo");
    // No extra fetch triggered by a state-changed event
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE event types it does not handle", async () => {
    const runs = [makeRun({ id: "r1" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual(runs);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
