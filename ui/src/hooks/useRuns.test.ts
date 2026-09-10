import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRuns } from "./useRuns";
import { api, type Run } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRuns: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
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
    ...overrides,
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    vi.mocked(api.getRuns).mockReset();
    sseHandler = null;
  });

  it("loads runs on mount without a state filter", async () => {
    vi.mocked(api.getRuns).mockResolvedValue({ runs: [makeRun()] });
    const { result } = renderHook(() => useRuns());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(1);
    expect(api.getRuns).toHaveBeenCalledWith(undefined);
  });

  it("passes the state filter through to the api call", async () => {
    vi.mocked(api.getRuns).mockResolvedValue({ runs: [] });
    renderHook(() => useRuns("Done"));
    await waitFor(() => expect(api.getRuns).toHaveBeenCalledWith("Done"));
  });

  it("surfaces an error message when the fetch fails", async () => {
    vi.mocked(api.getRuns).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    vi.mocked(api.getRuns).mockRejectedValue("nope");
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch runs");
  });

  it("refetches the full list when a run:created event arrives", async () => {
    vi.mocked(api.getRuns).mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(api.getRuns).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "run:created", runId: "r2" });
    });
    await waitFor(() => expect(api.getRuns).toHaveBeenCalledTimes(2));
  });

  it("patches a single run's state in place on run:state-changed", async () => {
    vi.mocked(api.getRuns).mockResolvedValue({ runs: [makeRun({ id: "r1", state: "Planning" })] });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "Implementing" });
    });

    expect(result.current.runs[0]!.state).toBe("Implementing");
    expect(api.getRuns).toHaveBeenCalledTimes(1);
  });

  it("leaves other runs untouched on run:state-changed", async () => {
    vi.mocked(api.getRuns).mockResolvedValue({
      runs: [makeRun({ id: "r1", state: "Planning" }), makeRun({ id: "r2", state: "Planning" })],
    });
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      sseHandler!({ type: "run:state-changed", runId: "r1", to: "Done" });
    });

    expect(result.current.runs.find((r) => r.id === "r2")!.state).toBe("Planning");
  });

  it("ignores unrelated SSE event types", async () => {
    vi.mocked(api.getRuns).mockResolvedValue({ runs: [] });
    renderHook(() => useRuns());
    await waitFor(() => expect(api.getRuns).toHaveBeenCalledTimes(1));

    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });
    expect(api.getRuns).toHaveBeenCalledTimes(1);
  });
});
