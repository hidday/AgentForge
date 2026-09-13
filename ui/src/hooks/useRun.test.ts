import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

import { api, type Run, type Artifact, type RunEventRecord } from "@/api/client.ts";
import { useRun } from "./useRun.ts";
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

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

const artifacts: Artifact[] = [];
const events: RunEventRecord[] = [];

describe("useRun", () => {
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

  it("starts in a loading state with no data or error", () => {
    mockApi.getRun.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads run detail successfully", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ run, artifacts, events });
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets the error message from an Error rejection and leaves data null", async () => {
    mockApi.getRun.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRun.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("clears a previous error on a subsequent successful refetch", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.error).toBe("boom"));

    const run = makeRun();
    mockApi.getRun.mockResolvedValueOnce({ run, artifacts, events });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ run, artifacts, events });
  });

  it("refetches when an SSE event for the same run arrives", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    const updatedRun = makeRun({ state: "executing" });
    mockApi.getRun.mockResolvedValue({ run: updatedRun, artifacts, events });

    const source = FakeEventSource.instances[0]!;
    await act(async () => {
      source.emit({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data?.run.state).toBe("executing"));
  });

  it("ignores SSE events for a different run", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-invokes the API", async () => {
    const run = makeRun();
    mockApi.getRun.mockResolvedValue({ run, artifacts, events });
    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("closes the SSE connection on unmount", async () => {
    mockApi.getRun.mockResolvedValue({ run: makeRun(), artifacts, events });
    const { unmount } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    unmount();

    expect(source.closed).toBe(true);
  });

  it("refetches for the new runId when runId changes", async () => {
    mockApi.getRun.mockResolvedValue({ run: makeRun(), artifacts, events });
    const { rerender } = renderHook(({ runId }) => useRun(runId), {
      initialProps: { runId: "run-1" },
    });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-1"));

    rerender({ runId: "run-2" });
    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledWith("run-2"));
  });
});
