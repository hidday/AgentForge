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
    pid: 123,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes, no output, and hasActive false", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes).toHaveLength(1);
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
    await waitFor(() => expect(result.current.output).toBe("hello"));
  });

  it("does not request output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("silently tolerates the process-output fetch failing (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("404"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("silently tolerates the initial getActiveProcesses call failing (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not update state after unmount while the initial fetch is still pending", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolving after unmount should not throw or cause a React warning.
    await act(async () => {
      resolveProcesses({ processes: [makeProcess()] });
    });
  });

  it("does not apply output once unmounted, even if getActiveProcesses resolved first", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());

    unmount();

    // Resolving after unmount should not throw or warn about state updates on
    // an unmounted component.
    await act(async () => {
      resolveOutput({ processId: "proc-1", output: "late output" });
    });
  });

  it("adds a process on a process:started SSE event for the same run and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback?.({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2024-02-01T00:00:00Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-2",
      command: "pnpm build",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2024-02-01T00:00:00Z",
    });
    expect(result.current.output).toBe("");
  });

  it("defaults process:started fields and timestamp when absent from the event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback?.({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess({ id: "proc-1" })] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    await act(async () => {
      sseCallback?.({ type: "process:completed", runId: "run-1", processId: "proc-1" });
    });

    expect(result.current.processes).toHaveLength(0);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends output chunks from process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "start\n" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.output).toBe("start\n"));

    await act(async () => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "more output" });
    });

    expect(result.current.output).toBe("start\nmore output");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "a".repeat(9000) });
    });

    expect(result.current.output).toHaveLength(8192);
  });

  it("ignores process:output events with an empty/falsy chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback?.({ type: "process:started", runId: "other-run" });
    });

    expect(result.current.processes).toHaveLength(0);
  });
});
