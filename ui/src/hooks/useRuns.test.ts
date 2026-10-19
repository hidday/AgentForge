import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "repo",
    branchName: null,
    prNumber: null,
    state,
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
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts loading with an empty list", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
  });

  it("fetches without a state filter when none is given", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith(undefined));
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("executing"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("executing"));
  });

  it("loads runs successfully", async () => {
    const runs = [makeRun("run-1", "planning")];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
  });

  it("surfaces the Error message on fetch failure", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the whole list when a run:created SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    await act(async () => {
      capturedHandler!({ type: "run:created", runId: "run-2" });
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("locally patches a run's state on run:state-changed without refetching", async () => {
    const runs = [makeRun("run-1", "planning")];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1", to: "executing" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs[0]!.state).toBe("executing");
  });

  it("does not patch runs that don't match the event's runId", async () => {
    const runs = [makeRun("run-1", "planning")];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "other-run", to: "executing" });
    });

    expect(result.current.runs[0]!.state).toBe("planning");
  });

  it("ignores SSE event types it doesn't handle", async () => {
    const runs = [makeRun("run-1", "planning")];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    act(() => {
      capturedHandler!({ type: "process:started", runId: "run-1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual(runs);
  });
});
