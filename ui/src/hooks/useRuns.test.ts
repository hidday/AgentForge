import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
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
    sseHandler = null;
  });

  it("starts in a loading state with no runs and no error", async () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("fetches runs on mount and exposes them once loaded", async () => {
    const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2" })];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("sets a generic error message when the fetch rejects with a non-Error", async () => {
    mockApi.getRuns.mockRejectedValue("nope");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes api.getRuns and updates state", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValueOnce({ runs });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual(runs);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("re-fetches runs when a run:created SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const runs = [makeRun({ id: "new-run" })];
    mockApi.getRuns.mockResolvedValueOnce({ runs });

    await act(async () => {
      sseHandler?.({ type: "run:created", runId: "new-run" });
    });

    await waitFor(() => expect(result.current.runs).toEqual(runs));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("updates a single run's state in place on a run:state-changed event without refetching", async () => {
    const runs = [makeRun({ id: "run-1", state: "Planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "run-1", to: "Implementing" });
    });

    expect(result.current.runs[0]!.state).toBe("Implementing");
    // Only the initial mount fetch — no refetch for state-changed events.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched on a run:state-changed event for a different run", async () => {
    const runs = [
      makeRun({ id: "run-1", state: "Planning" }),
      makeRun({ id: "run-2", state: "Planning" }),
    ];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler?.({ type: "run:state-changed", runId: "run-2", to: "Done" });
    });

    expect(result.current.runs.find((r) => r.id === "run-1")!.state).toBe("Planning");
    expect(result.current.runs.find((r) => r.id === "run-2")!.state).toBe("Done");
  });

  it("ignores unrelated SSE event types", async () => {
    const runs = [makeRun({ id: "run-1", state: "Planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler?.({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.runs).toEqual(runs);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
