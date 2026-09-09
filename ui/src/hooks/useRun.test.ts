import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestSSEHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

const run: Run = {
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
  workingDirectory: "/tmp",
  latestArtifactVersion: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const artifacts: Artifact[] = [];
const events: RunEventRecord[] = [];

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading and resolves with run detail data", async () => {
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ run, artifacts, events });
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message when the fetch fails with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useRun("missing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when a non-Error is thrown", async () => {
    mockApi.getRun.mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes api.getRun and updates data", async () => {
    mockApi.getRun.mockResolvedValueOnce({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = { ...run, state: "Planning" };
    mockApi.getRun.mockResolvedValueOnce({ run: updatedRun, artifacts, events });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data?.run.state).toBe("Planning");
  });

  it("refetches when an SSE event for this run arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    const updatedRun = { ...run, state: "Implementing" };
    mockApi.getRun.mockResolvedValue({ run: updatedRun, artifacts, events });

    await act(async () => {
      latestSSEHandler()({ type: "run:state-changed", runId: "run-1", to: "Implementing" });
    });

    await waitFor(() => expect(result.current.data?.run.state).toBe("Implementing"));
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      latestSSEHandler()({ type: "run:state-changed", runId: "other-run", to: "Done" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });
});
