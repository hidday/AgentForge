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
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const run: Run = {
  id: "r1",
  linearIssueId: "issue-1",
  linearIssueIdentifier: "ISS-1",
  linearIssueDescription: null,
  linearIssueTitle: "Title",
  linearIssueUrl: null,
  repo: "org/repo",
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
  latestArtifactVersion: 0,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};
const artifacts: Artifact[] = [];
const events: RunEventRecord[] = [];

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with null data and no error", async () => {
    let resolveFetch!: (v: { run: Run; artifacts: Artifact[]; events: RunEventRecord[] }) => void;
    mockApi.getRun.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );

    const { result } = renderHook(() => useRun("r1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveFetch({ run, artifacts, events });
    });
  });

  it("fetches by runId and updates data on success", async () => {
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
    expect(result.current.data).toEqual({ run, artifacts, events });
    expect(result.current.error).toBeNull();
  });

  it("sets error state on rejection with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run not found"));

    const { result } = renderHook(() => useRun("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("run not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue({ weird: true });

    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes the API with the same runId", async () => {
    mockApi.getRun.mockResolvedValueOnce({ run, artifacts, events });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = { ...run, state: "Done" };
    mockApi.getRun.mockResolvedValueOnce({ run: updatedRun, artifacts, events });

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
    expect(result.current.data?.run.state).toBe("Done");
  });

  it("re-fetches on any SSE event for the matching runId", async () => {
    mockApi.getRun.mockResolvedValueOnce({ run, artifacts, events });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = { ...run, state: "Implementing" };
    mockApi.getRun.mockResolvedValueOnce({ run: updatedRun, artifacts, events });

    await act(async () => {
      sseCallback!({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    await waitFor(() => expect(result.current.data?.run.state).toBe("Implementing"));
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValueOnce({ run, artifacts, events });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run", to: "Done" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ run, artifacts, events });
  });
});
