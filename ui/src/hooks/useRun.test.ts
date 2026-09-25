import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun.ts";
import { api, type Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  }),
}));

const mockedGetRun = vi.mocked(api.getRun);

const run: Run = {
  id: "r1",
  linearIssueId: "li1",
  linearIssueIdentifier: null,
  linearIssueDescription: null,
  linearIssueTitle: null,
  linearIssueUrl: null,
  repo: "org/repo",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("useRun", () => {
  beforeEach(() => {
    sseHandler = null;
    mockedGetRun.mockReset();
  });

  it("starts in a loading state with null data and no error", async () => {
    mockedGetRun.mockResolvedValueOnce({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("loads run detail successfully", async () => {
    const payload = { run, artifacts: [{ id: "a1" }] as never[], events: [] };
    mockedGetRun.mockResolvedValueOnce(payload);

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(mockedGetRun).toHaveBeenCalledWith("r1");
  });

  it("sets an error message and stops loading when the fetch fails", async () => {
    mockedGetRun.mockRejectedValueOnce(new Error("run missing"));

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("run missing");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockedGetRun.mockRejectedValueOnce("oops");

    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for the same run arrives", async () => {
    mockedGetRun.mockResolvedValueOnce({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = { ...run, state: "reviewing" };
    mockedGetRun.mockResolvedValueOnce({
      run: updatedRun,
      artifacts: [],
      events: [],
    });

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() =>
      expect(result.current.data?.run.state).toBe("reviewing"),
    );
    expect(mockedGetRun).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different run", async () => {
    mockedGetRun.mockResolvedValueOnce({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other" });
    });

    expect(mockedGetRun).toHaveBeenCalledTimes(1);
    expect(result.current.data?.run).toEqual(run);
  });

  it("exposes a refetch function that re-runs the fetch", async () => {
    mockedGetRun.mockResolvedValueOnce({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = { ...run, state: "done" };
    mockedGetRun.mockResolvedValueOnce({
      run: updatedRun,
      artifacts: [],
      events: [],
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data?.run.state).toBe("done");
    expect(mockedGetRun).toHaveBeenCalledTimes(2);
  });
});
