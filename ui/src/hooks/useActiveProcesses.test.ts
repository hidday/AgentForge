import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";
import type { ActiveProcess } from "@/api/client.ts";

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

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 1234,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00.000Z",
    elapsedMs: 0,
    ...overrides,
  };
}

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with empty state before the initial fetch resolves", () => {
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
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "log line" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc.id);
    expect(result.current.output).toBe("log line");
    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
  });

  it("does not fetch output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("tolerates the initial process-list fetch failing (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    // Should not throw and should settle back to the empty defaults.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("tolerates the output fetch failing after a process ended", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    // Output fetch failed, so output should remain the initial empty string.
    expect(result.current.output).toBe("");
  });

  it("adds a process on a process:started SSE event for the same run and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({
      type: "process:started",
      runId: "run-1",
      processId: "proc-new",
      command: "run tests",
      stage: "Implementing",
      runtime: "claude",
      timestamp: "2024-02-01T00:00:00.000Z",
    });

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.processes[0]).toEqual({
      id: "proc-new",
      pid: 0,
      command: "run tests",
      runId: "run-1",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2024-02-01T00:00:00.000Z",
      elapsedMs: 0,
    });
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBe("proc-new");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "other-run", processId: "proc-x" });

    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on a process:completed SSE event", async () => {
    const proc = makeProcess({ id: "proc-1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    fireSSE({ type: "process:completed", runId: "run-1", processId: "proc-1" });

    await waitFor(() => expect(result.current.processes).toEqual([]));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks from process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "run-1", chunk: "hello " });
    fireSSE({ type: "process:output", runId: "run-1", chunk: "world" });

    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    fireSSE({ type: "process:output", runId: "run-1", chunk: bigChunk });
    fireSSE({ type: "process:output", runId: "run-1", chunk: bigChunk });

    await waitFor(() => expect(result.current.output).toHaveLength(8192));
    expect(result.current.output.endsWith("a")).toBe(true);
  });

  it("ignores a process:output event with an empty/undefined chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "run-1" });

    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.output).toBe("");
  });

  it("cleans up the init effect on unmount without setting state after unmount", async () => {
    let resolveFn: ((v: { processes: ActiveProcess[] }) => void) | null = null;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolving after unmount should not throw (the effect's `cancelled` flag
    // guards the subsequent setState calls).
    expect(() => resolveFn!({ processes: [makeProcess()] })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
