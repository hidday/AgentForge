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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix bug",
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with no runs", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("populates runs and clears loading on a successful fetch", async () => {
    const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2" })];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the api call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("Planning"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Planning"));
  });

  it("surfaces an Error's message on failure", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    mockApi.getRuns.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch re-invokes the api and clears a previous error", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.error).toBe("first failure"));

    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValueOnce({ runs });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toEqual(runs);
  });

  it("refetches all runs on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const runs = [makeRun({ id: "run-new" })];
    mockApi.getRuns.mockResolvedValueOnce({ runs });

    fireSSE({ type: "run:created", runId: "run-new" });

    await waitFor(() => expect(result.current.runs).toEqual(runs));
  });

  it("patches a single run's state in place on a run:state-changed SSE event", async () => {
    const runs = [makeRun({ id: "run-1", state: "Todo" }), makeRun({ id: "run-2", state: "Todo" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    fireSSE({ type: "run:state-changed", runId: "run-1", to: "Planning" });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "run-1")?.state).toBe("Planning"),
    );
    // The untouched run is left as-is.
    expect(result.current.runs.find((r) => r.id === "run-2")?.state).toBe("Todo");
    // Fetch should not have been called again for a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("cleans up on unmount without throwing", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { unmount } = renderHook(() => useRuns());
    expect(() => unmount()).not.toThrow();
  });
});
