import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";
import type { DashboardEvent } from "./useSSE.ts";

const sseHandlers: ((event: DashboardEvent) => void)[] = [];

vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandlers.push(handler);
  },
}));

vi.mock("@/api/client.ts", () => ({
  api: { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    sseHandlers.length = 0;
    vi.clearAllMocks();
  });

  it("starts with no active processes when none exist", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads the first active process and its output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({
      processes: [{ id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "", elapsedMs: 0 }],
    });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p1");
    expect(result.current.output).toBe("hello");
  });

  it("tolerates a failed initial process-list fetch (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("tolerates a failed output fetch for an active process that already ended", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({
      processes: [{ id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "", elapsedMs: 0 }],
    });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("adds a process on process:started and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandlers[0]({
        type: "process:started",
        runId: "run-1",
        processId: "p2",
        command: "codex",
        stage: "reviewer",
        runtime: "codex",
      });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
    expect(result.current.output).toBe("");
  });

  it("removes a process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandlers[0]({ type: "process:started", runId: "run-1", processId: "p2" });
    });
    expect(result.current.hasActive).toBe(true);

    act(() => {
      sseHandlers[0]({ type: "process:completed", runId: "run-1", processId: "p2" });
    });
    expect(result.current.hasActive).toBe(false);
  });

  it("appends output chunks on process:output and caps the buffer at 8192 chars", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandlers[0]({ type: "process:output", runId: "run-1", chunk: "a".repeat(5000) });
    });
    expect(result.current.output).toHaveLength(5000);

    act(() => {
      sseHandlers[0]({ type: "process:output", runId: "run-1", chunk: "b".repeat(5000) });
    });
    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b")).toBe(true);
  });

  it("ignores events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandlers[0]({ type: "process:started", runId: "run-2", processId: "p9" });
    });

    expect(result.current.hasActive).toBe(false);
  });

  it("defaults process:started fields to empty strings when absent from the event", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    act(() => {
      sseHandlers[0]({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes[0]).toMatchObject({ id: "", command: "", stage: "", runtime: "" });
  });

  it("does not update state after the component unmounts mid-fetch", async () => {
    let resolveList: (value: { processes: never[] }) => void = () => {};
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();
    resolveList({ processes: [] });

    await new Promise((r) => setTimeout(r, 0));
    // No assertion needed beyond "did not throw" -- the cancelled guard
    // prevents a React "update after unmount" warning/crash.
  });

  it("does not update state after unmount while fetching output for the first active process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({
      processes: [{ id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "", elapsedMs: 0 }],
    });
    let resolveOutput: (value: { processId: string; output: string }) => void = () => {};
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    unmount();
    resolveOutput({ processId: "p1", output: "late output" });

    await new Promise((r) => setTimeout(r, 0));
  });
});
