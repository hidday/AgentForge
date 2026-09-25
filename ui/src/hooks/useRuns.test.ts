import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";
import { api, type Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  }),
}));

const mockedGetRuns = vi.mocked(api.getRuns);

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "li1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    sseHandler = null;
    mockedGetRuns.mockReset();
  });

  it("starts in a loading state with no runs and no error", async () => {
    mockedGetRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("loads runs successfully and clears the loading state", async () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" })];
    mockedGetRuns.mockResolvedValueOnce({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockedGetRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the api call", async () => {
    mockedGetRuns.mockResolvedValueOnce({ runs: [] });

    renderHook(() => useRuns("running"));

    await waitFor(() => expect(mockedGetRuns).toHaveBeenCalledWith("running"));
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockedGetRuns.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockedGetRuns.mockRejectedValueOnce("plain string failure");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches when an SSE run:created event arrives", async () => {
    mockedGetRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newRun = makeRun({ id: "r2" });
    mockedGetRuns.mockResolvedValueOnce({ runs: [newRun] });

    act(() => {
      sseHandler!({ type: "run:created", runId: "r2" });
    });

    await waitFor(() => expect(result.current.runs).toEqual([newRun]));
    expect(mockedGetRuns).toHaveBeenCalledTimes(2);
  });

  it("patches the run state in place on a run:state-changed event without refetching", async () => {
    const run = makeRun({ id: "r1", state: "planning" });
    mockedGetRuns.mockResolvedValueOnce({ runs: [run] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "executing" });
    });

    expect(result.current.runs).toEqual([{ ...run, state: "executing" }]);
    expect(mockedGetRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves runs untouched when a run:state-changed event targets an unknown run", async () => {
    const run = makeRun({ id: "r1", state: "planning" });
    mockedGetRuns.mockResolvedValueOnce({ runs: [run] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other", to: "executing" });
    });

    expect(result.current.runs).toEqual([run]);
  });

  it("ignores SSE event types it does not handle", async () => {
    const run = makeRun({ id: "r1" });
    mockedGetRuns.mockResolvedValueOnce({ runs: [run] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs).toEqual([run]);
    expect(mockedGetRuns).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-runs the fetch", async () => {
    mockedGetRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const refreshed = [makeRun({ id: "r3" })];
    mockedGetRuns.mockResolvedValueOnce({ runs: refreshed });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual(refreshed);
    expect(mockedGetRuns).toHaveBeenCalledTimes(2);
  });
});
