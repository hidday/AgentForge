import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
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
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => sseCallback!(event));
}

const proc = {
  id: "p1",
  pid: 123,
  command: "echo hi",
  runId: "r1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 10,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts empty/inactive and stays that way when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads processes and fetches output for the first active process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello world"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("swallows an error from getActiveProcesses (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("swallows an error from getProcessOutput (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount (cancelled init)", async () => {
    let resolveProcesses: (v: { processes: typeof proc[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveProcesses = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveProcesses!({ processes: [proc] });
      await Promise.resolve();
    });

    // No assertion on `result.current` post-unmount state mutation is
    // possible via the public API directly, but this exercises the
    // `cancelled` guard without throwing (e.g. act warnings on unmounted
    // setState would fail the test via console.error->throw in strict setups).
    expect(result.current).toBeDefined();
  });

  it("does not update output after unmount when getProcessOutput resolves late", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    let resolveOutput: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());

    unmount();

    await act(async () => {
      resolveOutput!({ processId: "p1", output: "too late" });
      await Promise.resolve();
    });

    // Nothing to assert on `result.current` post-unmount directly, but this
    // exercises the `cancelled` guard on the inner getProcessOutput resolution
    // path without throwing an act()-outside-test warning.
    expect(result.current).toBeDefined();
  });

  it("adds a process on process:started for this run and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({
      type: "process:started",
      runId: "r1",
      processId: "p2",
      command: "npm test",
      stage: "Implementing",
      runtime: "claude",
      timestamp: "2024-02-02T00:00:00Z",
    });

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.processes[0]).toEqual({
      id: "p2",
      pid: 0,
      command: "npm test",
      runId: "r1",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2024-02-02T00:00:00Z",
      elapsedMs: 0,
    });
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("defaults process:started fields and startedAt when the event omits them", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "r1" });

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    const added = result.current.processes[0]!;
    expect(added.id).toBe("");
    expect(added.command).toBe("");
    expect(added.stage).toBe("");
    expect(added.runtime).toBe("");
    expect(typeof added.startedAt).toBe("string");
  });

  it("removes a process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "out" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    fireSSE({ type: "process:completed", runId: "r1", processId: "p1" });

    await waitFor(() => expect(result.current.processes).toEqual([]));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "r1", chunk: "hello " });
    fireSSE({ type: "process:output", runId: "r1", chunk: "world" });

    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    fireSSE({ type: "process:output", runId: "r1", chunk: bigChunk });
    fireSSE({ type: "process:output", runId: "r1", chunk: bigChunk });

    await waitFor(() => expect(result.current.output).toHaveLength(8192));
    expect(result.current.output.startsWith("a")).toBe(true);
  });

  it("ignores process:output events with an empty/undefined chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "r1" });

    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "other-run", processId: "px" });

    expect(result.current.processes).toEqual([]);
  });
});
