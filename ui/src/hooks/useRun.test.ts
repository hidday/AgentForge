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
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
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
    ...overrides,
  };
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts in a loading state with null data and no error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRun("run-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the run on mount and populates data on success", async () => {
    const run = makeRun();
    const artifacts: Artifact[] = [];
    const events: RunEventRecord[] = [];
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual({ run, artifacts, events });
    expect(result.current.error).toBeNull();
  });

  it("sets an error message and clears loading when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error instance", async () => {
    mockApi.getRun.mockRejectedValue("not an error object");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("re-fetches when refetch() is called", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts: [], events: [] });

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("re-fetches on an SSE event for the same runId", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts: [], events: [] });

    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    expect(sseHandler).not.toBeNull();
    await act(async () => {
      sseHandler!({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores an SSE event for a different runId", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts: [], events: [] });

    renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(1));

    await act(async () => {
      sseHandler!({ type: "run:state-changed", runId: "other-run" });
    });

    // Give any stray microtask a chance to run, then assert no extra fetch happened.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });
});
