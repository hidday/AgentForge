import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

const sseCallbacks: Array<(event: DashboardEvent) => void> = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallbacks.push(cb);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() },
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks.length = 0;
  });

  it("starts with no active processes when none exist", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads existing active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({
      processes: [{ id: "p1", pid: 1, command: "run", runId: "r1", stage: "implement", runtime: "claude", startedAt: "t", elapsedMs: 0 }],
    });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p1");
    expect(result.current.output).toBe("hello");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("tolerates the process output fetch failing (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({
      processes: [{ id: "p1", pid: 1, command: "run", runId: "r1", stage: "implement", runtime: "claude", startedAt: "t", elapsedMs: 0 }],
    });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("tolerates the initial processes fetch failing (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("restarting"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([]));
    expect(result.current.hasActive).toBe(false);
  });

  it("adds a process and clears prior output on a process:started event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallbacks[0]!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "exec",
        stage: "review",
        runtime: "codex",
        timestamp: "2024-01-01T00:00:00Z",
      });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
    expect(result.current.output).toBe("");
  });

  it("appends output chunks on process:output events, capping at 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallbacks[0]!({ type: "process:output", runId: "r1", processId: "p1", chunk: "abc" });
    });
    expect(result.current.output).toBe("abc");

    const bigChunk = "x".repeat(9000);
    act(() => {
      sseCallbacks[0]!({ type: "process:output", runId: "r1", processId: "p1", chunk: bigChunk });
    });
    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output).toBe((("abc" + bigChunk)).slice(-8192));
  });

  it("removes the process on a process:completed event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({
      processes: [{ id: "p1", pid: 1, command: "run", runId: "r1", stage: "x", runtime: "claude", startedAt: "t", elapsedMs: 0 }],
    });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    act(() => {
      sseCallbacks[0]!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toEqual([]);
  });

  it("defaults missing optional fields on a process:started event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallbacks[0]!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("does not update state if the component unmounts before the initial fetch resolves", async () => {
    let resolveProcesses!: (v: { processes: unknown[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [{ id: "p1", pid: 1, command: "x", runId: "r1", stage: "s", runtime: "claude", startedAt: "t", elapsedMs: 0 }] });
      await Promise.resolve();
    });

    // No assertion needed beyond "does not throw" — the cancelled guard
    // prevents setState after unmount.
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("does not update output if the component unmounts before the output fetch resolves", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({
      processes: [{ id: "p1", pid: 1, command: "x", runId: "r1", stage: "s", runtime: "claude", startedAt: "t", elapsedMs: 0 }],
    });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
    });
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallbacks[0]!({ type: "process:started", runId: "other", processId: "p9" });
    });

    expect(result.current.hasActive).toBe(false);
  });
});
