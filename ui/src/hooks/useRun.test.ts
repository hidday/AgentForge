import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRun: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";
import { useRun } from "./useRun.ts";

const mockApi = api as unknown as { getRun: ReturnType<typeof vi.fn> };

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

function makeDetail(overrides: Partial<Run> = {}) {
  const artifacts: Artifact[] = [];
  const events: RunEventRecord[] = [];
  return { run: makeRun(overrides), artifacts, events };
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  mockApi.getRun.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRun", () => {
  it("starts in a loading state and populates data on success", async () => {
    const detail = makeDetail();
    mockApi.getRun.mockResolvedValue(detail);

    const { result } = renderHook(() => useRun("run-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRun).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message and leaves data null when the fetch rejects with an Error", async () => {
    mockApi.getRun.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRun.mockRejectedValue("not-an-error");

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run");
  });

  it("refetch() re-invokes the API and clears a previous error on success", async () => {
    mockApi.getRun.mockRejectedValueOnce(new Error("first failure"));
    const detail = makeDetail();
    mockApi.getRun.mockResolvedValueOnce(detail);

    const { result } = renderHook(() => useRun("run-1"));

    await waitFor(() => expect(result.current.error).toBe("first failure"));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(detail);
    expect(mockApi.getRun).toHaveBeenCalledTimes(2);
  });

  it("refetches when an SSE event for the same runId arrives", async () => {
    mockApi.getRun.mockResolvedValue(makeDetail());

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "run:state-changed", runId: "run-1", to: "executing" }),
      });
    });

    await waitFor(() => expect(mockApi.getRun).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRun.mockResolvedValue(makeDetail());

    const { result } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "run:state-changed", runId: "other-run", to: "executing" }),
      });
    });

    expect(mockApi.getRun).toHaveBeenCalledTimes(1);
  });

  it("closes its SSE subscription on unmount", async () => {
    mockApi.getRun.mockResolvedValue(makeDetail());

    const { result, unmount } = renderHook(() => useRun("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = latestSource();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
