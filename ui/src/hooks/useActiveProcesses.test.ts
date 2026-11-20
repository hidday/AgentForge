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

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const process1 = {
  id: "proc-1",
  pid: 123,
  command: "npm test",
  runId: "run-1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2026-01-01T00:00:00.000Z",
  elapsedMs: 1000,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes, no output and hasActive false", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "building..." });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([process1]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-1");
    await waitFor(() => expect(result.current.output).toBe("building..."));
    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("does not call getProcessOutput when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(false));
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("silently swallows a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("silently swallows a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([process1]));
    // Output stays empty since the fetch failed, but no crash / unhandled rejection.
    expect(result.current.output).toBe("");
  });

  it("adds a new process and clears output on process:started for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2026-01-01T00:00:05.000Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-2",
      command: "pnpm build",
      runId: "run-1",
      stage: "Implementing",
      runtime: "claude",
      pid: 0,
      elapsedMs: 0,
    });
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("uses defaults for process:started fields that are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    act(() => {
      sseCallback!({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0].startedAt).toBe("string");
  });

  it("removes a process on process:completed for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    act(() => {
      sseCallback!({ type: "process:completed", runId: "run-1", processId: "proc-1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", processId: "proc-1", chunk: "line 1\n" });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", processId: "proc-1", chunk: "line 2\n" });
    });

    expect(result.current.output).toBe("line 1\nline 2\n");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    const bigChunk = "a".repeat(5000);
    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", processId: "proc-1", chunk: bigChunk });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", processId: "proc-1", chunk: bigChunk });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("a")).toBe(true);
  });

  it("ignores process:output events with an empty/missing chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "existing" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.output).toBe("existing"));

    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", processId: "proc-1", chunk: "" });
    });

    expect(result.current.output).toBe("existing");
  });

  it("does not update state after unmount once getActiveProcesses resolves (cancelled guard)", async () => {
    let resolveProcesses!: (v: { processes: typeof process1[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [process1] });
      await Promise.resolve();
    });

    // No assertion on `result.current` is possible post-unmount, but the
    // resolved promise must not throw or trigger a React "state update on
    // unmounted component" warning — reaching here cleanly exercises the
    // `cancelled` guard right after the first await.
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("does not update output state after unmount once getProcessOutput resolves (cancelled guard)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    unmount();

    await act(async () => {
      resolveOutput({ processId: "proc-1", output: "late output" });
      await Promise.resolve();
    });

    // Reaching here without an unhandled error/warning exercises the
    // `cancelled` guard inside the nested getProcessOutput try block.
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    act(() => {
      sseCallback!({ type: "process:started", runId: "other-run", processId: "proc-x" });
    });

    expect(result.current.processes).toEqual([]);
  });
});
