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

const artifacts: Artifact[] = [];
const events: RunEventRecord[] = [];

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts in a loading state with null data and no error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run on mount and transitions to loaded state with data", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ run, artifacts, events });
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("Run not found"));

    const { result } = renderHook(() => useRun("missing-run"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRun.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes the API and updates data", async () => {
    const run1 = makeRun({ state: "planning" });
    const run2 = makeRun({ state: "executing" });
    mockApi.getRun.mockResolvedValueOnce({ run: run1, artifacts, events });

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.run.state).toBe("planning");

    mockApi.getRun.mockResolvedValueOnce({ run: run2, artifacts, events });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data?.run.state).toBe("executing");
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("clears a previous error on a successful refetch", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.error).toBe("boom"));

    const run = makeRun();
    mockApi.getRun.mockResolvedValueOnce({ run, artifacts, events });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ run, artifacts, events });
  });

  it("refetches when an SSE event for the same runId arrives", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    renderHook(() => useRun("run-1"));

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    expect(capturedHandler).not.toBeNull();
    await act(async () => {
      capturedHandler!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different runId", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    renderHook(() => useRun("run-1"));

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    expect(capturedHandler).not.toBeNull();
    act(() => {
      capturedHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    // give any stray async work a chance to run
    await new Promise((r) => setTimeout(r, 0));

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
