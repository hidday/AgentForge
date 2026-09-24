import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
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

describe("useRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in a loading state with no runs", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("resolves with runs from the API and clears loading", async () => {
    const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2" })];
    mockApi.getRuns.mockResolvedValue({ runs });

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(runs);
    expect(result.current.error).toBeNull();
  });

  it("passes the state filter through to api.getRuns", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });

    renderHook(() => useRuns("Done"));

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("sets an error message when the API call rejects with an Error", async () => {
    mockApi.getRuns.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.runs).toEqual([]);
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRuns.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRuns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetch() re-invokes the API and updates runs", async () => {
    mockApi.getRuns.mockResolvedValueOnce({ runs: [] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newRuns = [makeRun({ id: "run-3" })];
    mockApi.getRuns.mockResolvedValueOnce({ runs: newRuns });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.runs).toEqual(newRuns);
  });

  it("refetches automatically when an SSE run:created event arrives", async () => {
    mockApi.getRuns.mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({ data: JSON.stringify({ type: "run:created", runId: "run-9" }) });
    });

    await waitFor(() => expect(mockApi.getRuns).toHaveBeenCalledTimes(2));
  });

  it("updates a run's state locally (without refetching) on run:state-changed", async () => {
    const runs = [makeRun({ id: "run-1", state: "Planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "run:state-changed", runId: "run-1", to: "Implementing" }),
      });
    });

    expect(result.current.runs[0].state).toBe("Implementing");
    // No additional fetch beyond the initial one
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
  });

  it("does nothing (no refetch, no state change) for an unrelated SSE event type", async () => {
    const runs = [makeRun({ id: "run-1", state: "Planning" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({ data: JSON.stringify({ type: "process:completed", runId: "run-1" }) });
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.getRuns).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toEqual(runs);
  });

  it("leaves other runs untouched when run:state-changed targets a different run id", async () => {
    const runs = [makeRun({ id: "run-1", state: "Planning" }), makeRun({ id: "run-2", state: "Done" })];
    mockApi.getRuns.mockResolvedValue({ runs });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "run:state-changed", runId: "run-1", to: "Implementing" }),
      });
    });

    expect(result.current.runs[1].state).toBe("Done");
  });
});
