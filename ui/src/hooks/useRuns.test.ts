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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "branch",
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
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts in a loading state with an empty runs array and no error", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("fetches runs on mount with no state filter", async () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" })];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual(runs);
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter argument through to the API call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("executing"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("executing"));
  });

  it("re-fetches when the stateFilter argument changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { rerender } = renderHook(({ filter }: { filter?: string }) => useRuns(filter), {
      initialProps: { filter: undefined as string | undefined },
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    rerender({ filter: "paused" });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(mockApi.getRuns).toHaveBeenLastCalledWith("paused");
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("Server unavailable"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Server unavailable");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRuns.mockRejectedValue("oops");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes the API and returns fresh data", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun({ id: "r1" })] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(1);

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun({ id: "r1" }), makeRun({ id: "r2" })] });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toHaveLength(2);
  });

  it("refetches the full list on a 'run:created' SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns());

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    expect(capturedHandler).not.toBeNull();
    await act(async () => {
      capturedHandler!({ type: "run:created", runId: "new-run" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("updates a single run's state in place on a 'run:state-changed' SSE event without refetching", async () => {
    const run = makeRun({ id: "r1", state: "planning" });
    mockApi.getRuns.mockResolvedValue({ runs: [run] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(capturedHandler).not.toBeNull();
    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "r1", to: "executing" });
    });

    expect(result.current.runs[0]!.state).toBe("executing");
    // No additional fetch should have happened for an in-place state update
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched when a 'run:state-changed' event targets a different run", async () => {
    const run1 = makeRun({ id: "r1", state: "planning" });
    const run2 = makeRun({ id: "r2", state: "planning" });
    mockApi.getRuns.mockResolvedValue({ runs: [run1, run2] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "r1", to: "executing" });
    });

    expect(result.current.runs.find((r) => r.id === "r1")!.state).toBe("executing");
    expect(result.current.runs.find((r) => r.id === "r2")!.state).toBe("planning");
  });

  it("ignores SSE event types other than run:created and run:state-changed", async () => {
    const run = makeRun({ id: "r1", state: "planning" });
    mockApi.getRuns.mockResolvedValue({ runs: [run] });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      capturedHandler!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.runs[0]!.state).toBe("planning");
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
