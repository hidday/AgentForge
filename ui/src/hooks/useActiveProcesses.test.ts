import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts with empty processes, hasActive false, empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello output" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello output"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("does not fetch process output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("swallows an error from getActiveProcesses (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    // No throw, and state stays at its defaults.
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows an error from getProcessOutput (process may have just ended)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    // Output stays empty since the fetch failed, but no crash.
    expect(result.current.output).toBe("");
  });

  it("adds a new process on a process:started SSE event and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({
        type: "process:started",
        runId: "run-1",
        processId: "p2",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "claude",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "pnpm build",
      runId: "run-1",
    });
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("removes a process on a process:completed SSE event", async () => {
    const proc = makeProcess({ id: "p1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      sseHandler?.({ type: "process:completed", runId: "run-1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends output chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:output", runId: "run-1", chunk: "foo" });
    });
    act(() => {
      sseHandler?.({ type: "process:output", runId: "run-1", chunk: "bar" });
    });

    expect(result.current.output).toBe("foobar");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    act(() => {
      sseHandler?.({ type: "process:output", runId: "run-1", chunk: bigChunk });
    });
    act(() => {
      sseHandler?.({ type: "process:output", runId: "run-1", chunk: bigChunk });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output).toBe("a".repeat(8192));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({
        type: "process:started",
        runId: "other-run",
        processId: "p9",
      });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("ignores a process:output event with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:output", runId: "run-1" });
    });

    expect(result.current.output).toBe("");
  });

  it("cancels a pending init on unmount without updating state after unmount", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveProcesses = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolving after unmount should not throw (cancelled flag guards state updates).
    expect(() => resolveProcesses({ processes: [makeProcess()] })).not.toThrow();
  });
});
