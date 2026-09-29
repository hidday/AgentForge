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

const RUN: Run = {
  id: "r1",
  linearIssueId: "li1",
  linearIssueIdentifier: "ENG-1",
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
const ARTIFACTS: Artifact[] = [];
const EVENTS: RunEventRecord[] = [];

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts in a loading state with null data and no error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves with run detail data and clears loading", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and clears loading when the request fails", async () => {
    mockApi.getRun.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRun.mockRejectedValue("oops");
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = { ...RUN, state: "Implementing" };
    mockApi.getRun.mockResolvedValue({ run: updatedRun, artifacts: ARTIFACTS, events: EVENTS });

    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(result.current.data?.run.state).toBe("Implementing"));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    act(() => {
      sseCallback!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).not.toHaveBeenCalled();
  });

  it("refetch() can be called manually", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
