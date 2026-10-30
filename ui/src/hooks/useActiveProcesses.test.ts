import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() },
}));
vi.mock("./useSSE.ts", () => ({ useSSE: vi.fn() }));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeProcess(id: string): ActiveProcess {
  return {
    id,
    pid: 1,
    command: "echo",
    runId: "run-1",
    stage: "executor",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

function latestHandler(): (e: DashboardEvent) => void {
  return mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
    e: DashboardEvent,
  ) => void;
}

describe("useActiveProcesses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts with no active processes and empty output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads the active process and its output when one exists", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello"));
  });

  it("swallows a getProcessOutput failure for a process that already ended", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("swallows a getActiveProcesses failure (server restarting) and keeps processes empty", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
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
    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [makeProcess("p1")] });
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
  });

  it("does not apply a late getProcessOutput result if unmounted after getActiveProcesses resolves", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1"));

    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("adds a new process entry and resets output on process:started", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handleSSE = latestHandler();
    act(() => {
      handleSSE({
        type: "process:started",
        runId: "run-1",
        processId: "p2",
        command: "ls",
        stage: "reviewer",
        runtime: "codex",
        timestamp: "2024-02-02T00:00:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "ls",
        runId: "run-1",
        stage: "reviewer",
        runtime: "codex",
        startedAt: "2024-02-02T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.activeProcessId).toBe("p2");
    expect(result.current.output).toBe("");
  });

  it("falls back to defaults and a generated timestamp when optional started fields are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handleSSE = latestHandler();
    act(() => {
      handleSSE({ type: "process:started", runId: "run-1" });
    });

    const proc = result.current.processes[0]!;
    expect(proc.id).toBe("");
    expect(proc.command).toBe("");
    expect(proc.stage).toBe("");
    expect(proc.runtime).toBe("");
    expect(typeof proc.startedAt).toBe("string");
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handleSSE = latestHandler();
    act(() => {
      handleSSE({ type: "process:started", runId: "other-run", processId: "p9" });
    });
    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    const handleSSE = latestHandler();
    act(() => {
      handleSSE({ type: "process:completed", runId: "run-1", processId: "p1" });
    });
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends output chunks and truncates beyond 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handleSSE = latestHandler();
    act(() => {
      handleSSE({ type: "process:output", runId: "run-1", chunk: "abc" });
      handleSSE({ type: "process:output", runId: "run-1", chunk: "def" });
    });
    expect(result.current.output).toBe("abcdef");

    const bigChunk = "x".repeat(9000);
    act(() => {
      handleSSE({ type: "process:output", runId: "run-1", chunk: bigChunk });
    });
    expect(result.current.output.length).toBe(8192);
    expect(result.current.output).toBe(bigChunk.slice(-8192));
  });

  it("ignores process:output events with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handleSSE = latestHandler();
    act(() => {
      handleSSE({ type: "process:output", runId: "run-1", chunk: "" });
    });
    expect(result.current.output).toBe("");
  });
});
