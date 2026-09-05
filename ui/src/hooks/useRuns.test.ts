import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("./useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("./useSSE.ts")>("./useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

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
    sseCallback = null;
  });

  it("starts in a loading state, then populates runs on success", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("executing"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("executing"));
  });

  it("sets an error message when api.getRuns rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("nope");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("re-fetches on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "run-2" })] });
    fireSSE({ type: "run:created", runId: "run-2" });

    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("patches the matching run's state in place on run:state-changed, without refetching", async () => {
    const runs = [makeRun({ id: "run-1", state: "planning" }), makeRun({ id: "run-2", state: "planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(2));

    mockApi.getRuns.mockClear();
    fireSSE({ type: "run:state-changed", runId: "run-1", to: "executing" });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "run-1")?.state).toBe("executing"),
    );
    expect(result.current.runs.find((r) => r.id === "run-2")?.state).toBe("planning");
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores other SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    fireSSE({ type: "process:started", runId: "run-1" });
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });
});
