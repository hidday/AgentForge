import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

const sseCallbacks: Array<(event: DashboardEvent) => void> = [];
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallbacks.push(cb);
  },
}));

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

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
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

function latestSSECallback() {
  return sseCallbacks[sseCallbacks.length - 1]!;
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with empty state before the initial fetch resolves", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("stays empty when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(result.current.hasActive).toBe(false);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads the output of the first active process when one exists", async () => {
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello output" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.output).toBe("hello output"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(result.current.processes).toEqual([proc]);
  });

  it("silently tolerates getProcessOutput failing (process may have just ended)", async () => {
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.output).toBe("");
  });

  it("silently tolerates getActiveProcesses failing (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not update state after unmount before the process list resolves", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [makeProcess("proc-1")] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not update state after unmount before the process output resolves", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    // Let the first await (getActiveProcesses) resolve and getProcessOutput get called
    // before unmounting, so the *second* cancellation check (after getProcessOutput) runs.
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1"));
    unmount();

    await act(async () => {
      resolveOutput({ processId: "proc-1", output: "too late" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSECallback()({ type: "process:started", runId: "other-run", processId: "p1" });
    });
    expect(result.current.processes).toEqual([]);
  });

  it("process:started adds a new process entry and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSECallback()({
        type: "process:started",
        runId: "run-1",
        processId: "p1",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2024-02-02T00:00:00Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p1",
      command: "pnpm build",
      runId: "run-1",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2024-02-02T00:00:00Z",
    });
    expect(result.current.hasActive).toBe(true);
    expect(result.current.output).toBe("");
  });

  it("process:started falls back to defaults for missing optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSECallback()({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("process:completed removes the matching process", async () => {
    const proc = makeProcess("proc-1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      latestSSECallback()({ type: "process:completed", runId: "run-1", processId: "proc-1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("process:output appends the chunk to output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSECallback()({ type: "process:output", runId: "run-1", chunk: "first " });
    });
    act(() => {
      latestSSECallback()({ type: "process:output", runId: "run-1", chunk: "second" });
    });

    expect(result.current.output).toBe("first second");
  });

  it("process:output with no chunk does not change output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSECallback()({ type: "process:output", runId: "run-1" });
    });

    expect(result.current.output).toBe("");
  });

  it("process:output trims output to the last 8192 characters once the cap is exceeded", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSECallback()({ type: "process:output", runId: "run-1", chunk: "a".repeat(8000) });
    });
    expect(result.current.output.length).toBe(8000);

    act(() => {
      latestSSECallback()({ type: "process:output", runId: "run-1", chunk: "b".repeat(500) });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
  });
});
