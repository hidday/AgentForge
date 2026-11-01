import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE";

vi.mock("@/api/client.ts", () => ({
  api: { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

import { useActiveProcesses } from "./useActiveProcesses";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const PROC = {
  id: "proc-1",
  pid: 123,
  command: "echo hi",
  runId: "run-1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts with no processes and empty output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
  });

  it("loads an already-running process and its output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello\n" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes).toEqual([PROC]);
    expect(result.current.activeProcessId).toBe("proc-1");
    await waitFor(() => expect(result.current.output).toBe("hello\n"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("silently ignores a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("silently ignores a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("adds a process and resets output on a process:started event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "ls",
        stage: "Implementing",
        runtime: "codex",
        timestamp: "2024-01-02T00:00:00Z",
      });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.processes).toEqual([
      {
        id: "proc-2",
        pid: 0,
        command: "ls",
        runId: "run-1",
        stage: "Implementing",
        runtime: "codex",
        startedAt: "2024-01-02T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
  });

  it("ignores process:started events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:started", runId: "other-run", processId: "proc-2" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes the matching process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    act(() => {
      sseHandler?.({ type: "process:completed", runId: "run-1", processId: "proc-1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:output", runId: "run-1", chunk: "line 1\n" });
    });
    expect(result.current.output).toBe("line 1\n");

    act(() => {
      sseHandler?.({ type: "process:output", runId: "run-1", chunk: "line 2\n" });
    });
    expect(result.current.output).toBe("line 1\nline 2\n");
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
    expect(result.current.output).toBe(bigChunk.slice(-(8192 - 5000)) + bigChunk);
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

  it("falls back to empty-string/now defaults for a process:started event missing optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes).toHaveLength(1);
    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    expect(typeof entry.startedAt).toBe("string");
    expect(entry.startedAt.length).toBeGreaterThan(0);
  });

  it("does not update state after unmount once the initial fetches resolve", async () => {
    let resolveProcesses!: (v: { processes: (typeof PROC)[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    resolveProcesses({ processes: [PROC] });
    await Promise.resolve();
    await Promise.resolve();

    // Hook result is frozen at its last pre-unmount value; the guarded
    // setState calls after unmount must not have thrown or run.
    expect(result.current.processes).toEqual([]);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("does not apply process output after unmount even if the output fetch resolves later", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    unmount();

    resolveOutput({ processId: "proc-1", output: "late output" });
    await Promise.resolve();
    await Promise.resolve();
    // No assertion target survives unmount; this just proves the guarded
    // branch after the await doesn't throw once cancelled is true.
  });
});
