import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";
import { useRuns } from "./useRuns.ts";

const mockApi = api as unknown as { getRuns: ReturnType<typeof vi.fn> };

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    MockEventSource.instances.push(this);
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!source) throw new Error("no EventSource instance created");
  return source;
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

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  mockApi.getRuns.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRuns", () => {
  it("starts loading and populates runs on success, with no state filter by default", async () => {
    const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2" })];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the stateFilter argument through to the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("executing"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("executing"));
  });

  it("re-fetches when the stateFilter argument changes", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { rerender } = renderHook(({ state }: { state?: string }) => useRuns(state), {
      initialProps: { state: undefined as string | undefined },
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    rerender({ state: "done" });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
    expect(mockApi.getRuns).toHaveBeenLastCalledWith("done");
  });

  it("sets an error message and leaves runs empty when the fetch rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValue("nope");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes the API", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(2);
  });

  it("a run:created SSE event triggers a full refetch", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "run-1" })] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "run:created", runId: "run-2" }),
      });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("a run:state-changed SSE event updates the matching run locally without refetching", async () => {
    mockApi.getRuns.mockResolvedValue({
      runs: [makeRun({ id: "run-1", state: "planning" }), makeRun({ id: "run-2", state: "planning" })],
    });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "run:state-changed", runId: "run-1", to: "executing" }),
      });
    });

    // No additional fetch — state updated in place.
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    const updated = result.current.runs.find((r) => r.id === "run-1");
    const untouched = result.current.runs.find((r) => r.id === "run-2");
    expect(updated?.state).toBe("executing");
    expect(untouched?.state).toBe("planning");
  });

  it("ignores SSE events of other types", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [makeRun({ id: "run-1", state: "planning" })] });

    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:started", runId: "run-1" }),
      });
    });

    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs[0]!.state).toBe("planning");
  });

  it("closes its SSE subscription on unmount", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    const { result, unmount } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = latestSource();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
