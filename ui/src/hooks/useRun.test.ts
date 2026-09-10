import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRun } from "./useRun";
import { api, type Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

const run: Run = {
  id: "r1",
  linearIssueId: "i1",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("useRun", () => {
  beforeEach(() => {
    vi.mocked(api.getRun).mockReset();
    sseHandler = null;
  });

  it("loads run detail on mount", async () => {
    vi.mocked(api.getRun).mockResolvedValue({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ run, artifacts: [], events: [] });
    expect(result.current.error).toBeNull();
    expect(api.getRun).toHaveBeenCalledWith("r1");
  });

  it("surfaces an error message when the fetch fails", async () => {
    vi.mocked(api.getRun).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    vi.mocked(api.getRun).mockRejectedValue("boom");
    const { result } = renderHook(() => useRun("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when an SSE event for this run arrives", async () => {
    vi.mocked(api.getRun).mockResolvedValue({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(api.getRun).mockClear();
    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1" });
    });
    await waitFor(() => expect(api.getRun).toHaveBeenCalledTimes(1));
  });

  it("ignores SSE events for other runs", async () => {
    vi.mocked(api.getRun).mockResolvedValue({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(api.getRun).mockClear();
    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "other" });
    });
    expect(api.getRun).not.toHaveBeenCalled();
  });

  it("exposes a manual refetch function", async () => {
    vi.mocked(api.getRun).mockResolvedValue({ run, artifacts: [], events: [] });
    const { result } = renderHook(() => useRun("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(api.getRun).mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(api.getRun).toHaveBeenCalledTimes(1);
  });
});
