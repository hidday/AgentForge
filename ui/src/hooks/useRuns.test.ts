import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEventSource.instances.push(this);
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
    ...overrides,
  };
}

function emit(source: FakeEventSource, event: Record<string, unknown>) {
  act(() => {
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
  });
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in a loading state and fetches runs without a filter", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun()] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the fetch fails", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch re-invokes api.getRuns and clears a prior error on success", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockRejectedValueOnce(new Error("fail"));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe("fail");

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun()] });
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.runs).toHaveLength(1);
  });

  it("refetches all runs when a run:created SSE event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockResolvedValueOnce({ runs: [makeRun({ id: "run-new" })] });
    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:created", runId: "run-new" });

    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(result.current.runs[0]!.id).toBe("run-new");
  });

  it("patches a matching run's state in place on a run:state-changed event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "run-1", state: "Planning" })] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:state-changed", runId: "run-1", to: "Done" });

    await waitFor(() => expect(result.current.runs[0]!.state).toBe("Done"));
    // getRuns should not be called again for a state-changed event.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched when a run:state-changed event targets a different run", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [makeRun({ id: "run-1", state: "Planning" }), makeRun({ id: "run-2", state: "Planning" })],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(2));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:state-changed", runId: "run-2", to: "Done" });

    await waitFor(() =>
      expect(result.current.runs.find((r) => r.id === "run-2")!.state).toBe("Done"),
    );
    expect(result.current.runs.find((r) => r.id === "run-1")!.state).toBe("Planning");
  });

  it("ignores unrelated SSE event types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "run-1", state: "Planning" })] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "process:started", runId: "run-1" });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs[0]!.state).toBe("Planning");
  });
});
