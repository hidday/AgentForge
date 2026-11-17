import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

const sseCallback: { current: ((event: DashboardEvent) => void) | null } = { current: null };
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback.current = cb;
  },
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

function makeRunDetail(overrides: Partial<Run> = {}) {
  const run: Run = {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "repo",
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
  const artifacts: Artifact[] = [];
  const events: RunEventRecord[] = [];
  return { run, artifacts, events };
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback.current = null;
  });

  it("starts in a loading state and resolves with the fetched run detail", async () => {
    const detail = makeRunDetail();
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
  });

  it("exposes an error message when the fetch fails, with a fallback for non-Error throws", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("not found"));
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();

    mockApi.getRun.mockRejectedValueOnce("boom");
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for this run arrives, and ignores events for other runs", async () => {
    const detail = makeRunDetail();
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback.current!({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    act(() => {
      sseCallback.current!({ type: "run:state-changed", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("exposes a refetch function that re-runs the fetch on demand", async () => {
    const detail = makeRunDetail();
    mockApi.getRun.mockResolvedValue(detail);
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });
});
