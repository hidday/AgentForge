import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

function makeRun(id: string): Run {
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
  };
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts in a loading state with no data or error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads run detail successfully and exposes it", async () => {
    const detail = { run: makeRun("run-1"), artifacts: [] as Artifact[], events: [] as RunEventRecord[] };
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("surfaces the Error message on fetch failure", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("exposes a refetch function that re-invokes the API", async () => {
    mockApi.getRun.mockResolvedValue({ run: makeRun("run-1"), artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("refetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run: makeRun("run-1"), artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1" });
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue({ run: makeRun("run-1"), artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRun).not.toHaveBeenCalled();
  });
});
