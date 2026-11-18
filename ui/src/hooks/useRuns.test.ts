import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { useRuns } from "./useRuns.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
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
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function fireSSE(event: DashboardEvent) {
  act(() => {
    sseCallback?.(event);
  });
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state and fetches runs for no filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun()] });
    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("oops");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches when a run:created SSE event is received", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "run-2" })] });
    fireSSE({ type: "run:created", runId: "run-2" });

    await waitFor(() => expect(result.current.runs).toHaveLength(1));
  });

  it("patches an existing run's state in place on run:state-changed", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "run-1", state: "Planning" })] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    fireSSE({ type: "run:state-changed", runId: "run-1", to: "Implementing" });

    await waitFor(() => expect(result.current.runs[0].state).toBe("Implementing"));
    // getRuns should not have been called again for a state-changed event
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched on run:state-changed", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [makeRun({ id: "run-1", state: "Planning" }), makeRun({ id: "run-2", state: "Done" })],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(2));

    fireSSE({ type: "run:state-changed", runId: "run-1", to: "Implementing" });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "run-2")?.state).toBe("Done"),
    );
  });

  it("exposes a refetch function that re-fetches runs", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValue({ runs: [makeRun()] });
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.runs).toHaveLength(1);
  });

  it("ignores SSE event types it does not handle", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "process:started", runId: "run-1" });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });
});
