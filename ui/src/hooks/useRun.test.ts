import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

const sseCallbacks: Array<(event: DashboardEvent) => void> = [];
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallbacks.push(cb);
  },
}));

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN: Run = {
  id: "run-1",
  linearIssueId: "li-1",
  linearIssueIdentifier: "ENG-1",
  linearIssueDescription: null,
  linearIssueTitle: "Title",
  linearIssueUrl: null,
  repo: "org/repo",
  branchName: null,
  prNumber: null,
  state: "Implementing",
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
const ARTIFACTS: Artifact[] = [];
const EVENTS: RunEventRecord[] = [];

function latestSSECallback() {
  return sseCallbacks[sseCallbacks.length - 1]!;
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks.length = 0;
  });

  it("starts loading and fetches the run detail for the given id", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    expect(result.current.error).toBeNull();
  });

  it("surfaces an Error's message on failure", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run not found"));
    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    mockApi.getRun.mockRejectedValue("nope");
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes api.getRun for the same id", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      latestSSECallback()({ type: "run:state-changed", runId: "other-run" });
    });
    expect(mockApi.getRun).not.toHaveBeenCalled();
  });

  it("refetches on an SSE event for the same run id", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      latestSSECallback()({ type: "run:artifact-created", runId: "run-1" });
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-1"));
  });
});
