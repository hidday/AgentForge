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
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(id: string): ActiveProcess {
  return {
    id,
    pid: 123,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "node",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts with no processes, no output and activeProcessId null", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(result.current.output).toBe("hello"));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("does not fetch process output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.hasActive).toBe(false);
  });

  it("silently swallows an error from getActiveProcesses (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
  });

  it("silently swallows an error from getProcessOutput (process may have just ended)", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.output).toBe("");
  });

  it("adds a process and resets output on an SSE process:started event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({
        type: "process:started",
        runId: "run-1",
        processId: "p2",
        command: "pnpm build",
        stage: "Implementing",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]!.id).toBe("p2");
    expect(result.current.processes[0]!.command).toBe("pnpm build");
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes the process on an SSE process:completed event", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      sseHandler!({ type: "process:completed", runId: "run-1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends chunks from process:output events to the output buffer", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "run-1", processId: "p1", chunk: "foo" });
    });
    act(() => {
      sseHandler!({ type: "process:output", runId: "run-1", processId: "p1", chunk: "bar" });
    });

    expect(result.current.output).toBe("foobar");
  });

  it("ignores a process:output event with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "run-1", processId: "p1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("truncates the output buffer to the last 8192 characters when it grows beyond that", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    act(() => {
      sseHandler!({ type: "process:output", runId: "run-1", processId: "p1", chunk: bigChunk });
    });
    act(() => {
      sseHandler!({
        type: "process:output",
        runId: "run-1",
        processId: "p1",
        chunk: "b".repeat(5000),
      });
    });

    expect(result.current.output.length).toBe(8192);
    // Only the tail should remain, so it should be all "b"s (the most recent chunk is 5000 "b"s,
    // which alone exceeds nothing, but combined with the first chunk the start gets sliced off).
    expect(result.current.output.endsWith("b")).toBe(true);
  });

  it("does not update state (or throw) when the component unmounts before the initial fetch resolves", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    expect(() => resolveProcesses({ processes: [makeProcess("p1")] })).not.toThrow();
    // Flush microtasks; nothing should error even though the component tree is gone.
    await act(async () => {
      await Promise.resolve();
    });
  });
});
