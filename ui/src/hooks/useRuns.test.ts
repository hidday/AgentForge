import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { useRuns } from "./useRuns";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeRun(id: string, state: string): Run {
  return {
    id,
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state and transitions to loaded data on success", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "Planning")] });

    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.error).toBeNull();
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

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValue("not an error object");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-requests the runs and clears a previous error on success", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun("r1", "Done")] });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.runs).toHaveLength(1);
  });

  it("re-fetches all runs on a 'run:created' SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    await act(async () => {
      handler({ type: "run:created", runId: "new-run" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("applies a 'run:state-changed' SSE event in place, without a refetch", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "Planning")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    expect(result.current.runs[0]!.state).toBe("Done");
    // Only the initial fetch — no refetch triggered for state-changed.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("ignores a 'run:state-changed' event for a run that is not in the current list", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun("r1", "Planning")] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: unknown) => void;
    act(() => {
      handler({ type: "run:state-changed", runId: "unknown-run", to: "Done" });
    });

    expect(result.current.runs[0]!.state).toBe("Planning");
  });
});
