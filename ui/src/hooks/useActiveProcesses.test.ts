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

function makeProcess(id: string): ActiveProcess {
  return {
    id,
    pid: 123,
    command: "echo hi",
    runId: "run-1",
    stage: "executor",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts with no active processes and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads an active process and its output on mount", async () => {
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes).toEqual([proc]);
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(result.current.output).toBe("hello");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("does not fetch output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("silently tolerates a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("silently tolerates a getProcessOutput failure (process may have just ended)", async () => {
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes).toEqual([proc]);
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount (cancellation guard)", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [makeProcess("proc-1")] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
  });

  it("does not set output after unmount even if getActiveProcesses already resolved (inner cancellation guard)", async () => {
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    unmount();
    await act(async () => {
      resolveOutput({ processId: "proc-1", output: "late output" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("adds a process and resets output on a process:started SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "npm test",
        stage: "executor",
        runtime: "claude-code",
        timestamp: "2024-02-01T00:00:00Z",
      });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.processes[0]).toEqual({
      id: "proc-2",
      pid: 0,
      command: "npm test",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2024-02-01T00:00:00Z",
      elapsedMs: 0,
    });
    expect(result.current.output).toBe("");
  });

  it("fills in defaults for a process:started event missing optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes[0]!.id).toBe("");
    expect(result.current.processes[0]!.command).toBe("");
    expect(result.current.processes[0]!.stage).toBe("");
    expect(result.current.processes[0]!.runtime).toBe("");
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("removes a process on a process:completed SSE event", async () => {
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    act(() => {
      capturedHandler!({ type: "process:completed", runId: "run-1", processId: "proc-1" });
    });

    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toEqual([]);
  });

  it("appends chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "foo" });
    });
    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "bar" });
    });

    expect(result.current.output).toBe("foobar");
  });

  it("truncates output to the last 8192 characters when it grows too large", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "a".repeat(8000) });
    });
    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "b".repeat(500) });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
  });

  it("ignores a process:output event with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1" });
    });

    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:started", runId: "other-run" });
    });

    expect(result.current.processes).toEqual([]);
  });
});
