import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useRun } from "./useRun.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

const RUN: Run = {
  id: "run-1",
  linearIssueId: "li-1",
  linearIssueIdentifier: null,
  linearIssueDescription: null,
  linearIssueTitle: null,
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
  latestArtifactVersion: 1,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};
const ARTIFACTS: Artifact[] = [];
const EVENTS: RunEventRecord[] = [];

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts loading with null data", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("fetches the run by id and exposes run/artifacts/events on success", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    expect(result.current.error).toBeNull();
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
    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("re-fetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    await act(async () => {
      sseHandler!({ type: "run:state-changed", runId: "run-1" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("refetch triggers another call to api.getRun", async () => {
    mockApi.getRun.mockResolvedValue({ run: RUN, artifacts: ARTIFACTS, events: EVENTS });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRun.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
