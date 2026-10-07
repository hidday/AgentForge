import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { useRun } from "./useRun";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN: Run = {
  id: "r1",
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
  approvedPlanVersion: 1,
  plannerRuntime: null,
  executorRuntime: null,
  reviewerRuntime: null,
  remediationRuntime: null,
  workingDirectory: "/tmp",
  latestArtifactVersion: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const ARTIFACTS: Artifact[] = [];
const EVENTS: RunEventRecord[] = [];

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading and fetches the run detail on mount", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and leaves data null when the fetch fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("oops");
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-requests the run and clears a previous error", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));

    mockApi.getRun.mockResolvedValueOnce({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data?.run.id).toBe("r1");
  });

  it("refetches on an SSE event matching this run's id", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = { ...RUN, state: "Done" };
    mockApi.getRun.mockResolvedValueOnce({ run: updatedRun, artifacts: ARTIFACTS, events: EVENTS });
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    await waitFor(() => expect(result.current.data?.run.state).toBe("Done"));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores an SSE event for a different run id", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run", to: "Done" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
    expect(result.current.data?.run.state).toBe("Implementing");
  });
});
