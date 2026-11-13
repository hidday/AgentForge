import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns.ts";
import { api, type Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor() {
    MockEventSource.instances.push(this);
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    linearIssueId: "li1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Todo",
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
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in a loading state with an empty runs list", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRuns());
    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("populates runs and clears loading on a successful fetch", async () => {
    const runs = [makeRun()];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the api call", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message and stops loading when the fetch rejects", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRuns.mockRejectedValue("boom");
    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch triggers another call to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun()] });
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toHaveLength(1);
  });

  it("refetches the full list on a run:created SSE event", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRuns.mockClear();
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "new-run" })] });
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "run:created", runId: "new-run" });
    });

    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("patches a single run's state in place on a run:state-changed SSE event, without refetching", async () => {
    const run = makeRun({ id: "r1", state: "Todo" });
    mockApi.getRuns.mockResolvedValue({ runs: [run] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    mockApi.getRuns.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({
        type: "run:state-changed",
        runId: "r1",
        to: "Planning",
      });
    });

    expect(result.current.runs[0]!.state).toBe("Planning");
    expect(mockApi.getRuns).not.toHaveBeenCalled();
  });

  it("ignores run:state-changed events for runs not in the current list", async () => {
    const run = makeRun({ id: "r1", state: "Todo" });
    mockApi.getRuns.mockResolvedValue({ runs: [run] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => {
      MockEventSource.instances[0]!.emit({
        type: "run:state-changed",
        runId: "other-run",
        to: "Planning",
      });
    });

    expect(result.current.runs[0]!.state).toBe("Todo");
  });

  it("ignores SSE event types that are neither run:created nor run:state-changed", async () => {
    const run = makeRun({ id: "r1", state: "Todo" });
    mockApi.getRuns.mockResolvedValue({ runs: [run] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    mockApi.getRuns.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "process:completed", runId: "r1" });
    });

    expect(mockApi.getRuns).not.toHaveBeenCalled();
    expect(result.current.runs[0]!.state).toBe("Todo");
  });
});
