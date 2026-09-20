import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("./useSSE.ts")>("./useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
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
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const artifacts: Artifact[] = [];
const events: RunEventRecord[] = [];

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

describe("useRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts loading with null data and no error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads run detail data on success", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ run, artifacts, events });
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("surfaces an Error's message on failure", async () => {
    mockApi.getRun.mockRejectedValue(new Error("run missing"));

    const { result } = renderHook(() => useRun("missing-run"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("run missing");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message when a non-Error is thrown", async () => {
    mockApi.getRun.mockRejectedValue("oops");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetches when the runId argument changes", async () => {
    const runA = makeRun({ id: "run-a" });
    const runB = makeRun({ id: "run-b" });
    mockApi.getRun.mockImplementation((id: string) =>
      Promise.resolve({ run: id === "run-a" ? runA : runB, artifacts, events }),
    );

    const { result, rerender } = renderHook(({ id }) => useRun(id), {
      initialProps: { id: "run-a" },
    });

    await waitFor(() => expect(result.current.data?.run.id).toBe("run-a"));

    rerender({ id: "run-b" });

    await waitFor(() => expect(result.current.data?.run.id).toBe("run-b"));
    expect(mockApi.getRun).toHaveBeenCalledWith("run-a");
    expect(mockApi.getRun).toHaveBeenCalledWith("run-b");
  });

  it("refetches on any SSE event for the matching runId", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    fireSSE({ type: "run:state-changed", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue({ run: makeRun(), artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fireSSE({ type: "run:state-changed", runId: "some-other-run" });

    // Give any (unwanted) async refetch a chance to happen, then confirm it didn't.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("exposes a manual refetch function that reloads the data", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedRun = makeRun({ state: "Done" });
    mockApi.getRun.mockResolvedValueOnce({ run: updatedRun, artifacts, events });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data?.run.state).toBe("Done");
  });
});
