import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

import { api, type Run } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: DashboardEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  }
}

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
    state: "planning",
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
    ...overrides,
  };
}

describe("useRuns", () => {
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    originalEventSource = (global as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (global as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it("starts in a loading state with an empty run list and no error", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("fetches with no state filter when none is provided", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns());

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith(undefined));
  });

  it("fetches with the given state filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("in_review"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("in_review"));
  });

  it("loads runs successfully", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
  });

  it("sets the error message from an Error rejection and leaves runs empty", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches when a run:created SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    const newRuns = [makeRun({ id: "run-2" })];
    mockApi.getRuns.mockResolvedValue({ runs: newRuns });

    const source = FakeEventSource.instances[0]!;
    await act(async () => {
      source.emit({ type: "run:created", runId: "run-2" });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.runs).toEqual(newRuns));
  });

  it("updates only the matching run's state on a run:state-changed event, without refetching", async () => {
    const runs = [makeRun({ id: "run-1", state: "planning" }), makeRun({ id: "run-2", state: "planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "run:state-changed", runId: "run-2", to: "executing" });
    });

    expect(result.current.runs).toEqual([
      makeRun({ id: "run-1", state: "planning" }),
      makeRun({ id: "run-2", state: "executing" }),
    ]);
    // Only the initial fetch — state-changed updates local state instead of refetching.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves the run list unchanged for an unrelated SSE event type", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toEqual(runs));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "process:output", runId: "run-1", chunk: "x" });
    });

    expect(result.current.runs).toEqual(runs);
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-invokes the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("closes the SSE connection on unmount", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { unmount } = renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    unmount();

    expect(source.closed).toBe(true);
  });

  it("refetches with the new filter when stateFilter changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { rerender } = renderHook(({ filter }) => useRuns(filter), {
      initialProps: { filter: "open" as string | undefined },
    });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("open"));

    rerender({ filter: "closed" });
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("closed"));
  });
});
