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

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "run executor",
    runId: "run-1",
    stage: "executing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts with empty processes, hasActive false, empty output, and null activeProcessId", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes on mount and fetches output for the first process", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("does not fetch process output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows a getProcessOutput failure (process may have just ended) and leaves output empty", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    // give the rejected getProcessOutput promise a chance to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.output).toBe("");
  });

  it("swallows a getActiveProcesses failure (server may be restarting) without throwing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not update state after unmount (cancelled guard)", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolve after unmount; should not throw or warn about state updates on unmounted component
    expect(() => {
      resolveProcesses({ processes: [makeProcess()] });
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));
  });

  it("adds a new process entry on a process:started SSE event for this run and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(capturedHandler).not.toBeNull();
    act(() => {
      capturedHandler!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "run planner",
        stage: "planning",
        runtime: "claude",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]!.id).toBe("proc-2");
    expect(result.current.processes[0]!.command).toBe("run planner");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.output).toBe("");
  });

  it("ignores process:started events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({
        type: "process:started",
        runId: "other-run",
        processId: "proc-2",
      });
    });

    expect(result.current.processes).toHaveLength(0);
  });

  it("removes the matching process on a process:completed SSE event", async () => {
    const proc = makeProcess({ id: "proc-1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));

    act(() => {
      capturedHandler!({
        type: "process:completed",
        runId: "run-1",
        processId: "proc-1",
      });
    });

    expect(result.current.processes).toHaveLength(0);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends chunks to output on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "chunk-1" });
    });
    expect(result.current.output).toBe("chunk-1");

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "chunk-2" });
    });
    expect(result.current.output).toBe("chunk-1chunk-2");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: bigChunk });
    });
    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: bigChunk });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output).toBe("a".repeat(8192));
  });

  it("does not append an empty chunk on a process:output event with no chunk field", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1" });
    });

    expect(result.current.output).toBe("");
  });
});
