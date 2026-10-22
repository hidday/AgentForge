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

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function fireSSE(event: DashboardEvent) {
  act(() => {
    sseCallback!(event);
  });
}

const activeProc = {
  id: "proc-1",
  pid: 123,
  command: "pnpm test",
  runId: "r1",
  stage: "Implementing",
  runtime: "codex",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 0,
} as never;

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes and empty output when there are none active", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads the active process and its output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [activeProc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "building..." });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([activeProc]));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
    await waitFor(() => expect(result.current.output).toBe("building..."));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-1");
  });

  it("swallows a failure fetching the process list (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows a failure fetching process output (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [activeProc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([activeProc]));
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount (cancelled flag)", async () => {
    let resolveProcesses!: (v: { processes: never[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );
    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [] });
      await Promise.resolve();
    });

    // No crash, and state stayed at its initial value.
    expect(result.current.processes).toEqual([]);
  });

  it("does not set output after unmount even if getProcessOutput resolves late", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [activeProc] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1"));

    unmount();
    await act(async () => {
      resolveOutput({ processId: "proc-1", output: "late output" });
      await Promise.resolve();
    });

    // Output was never applied — the cancelled check after the await caught it.
    expect(result.current.output).toBe("");
  });

  it("defaults missing optional fields on a process:started event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "r1", processId: undefined });

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    expect(typeof entry.startedAt).toBe("string");
    expect(entry.startedAt.length).toBeGreaterThan(0);
  });

  it("appends a process on a process:started event for this run, resetting output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({
      type: "process:started",
      runId: "r1",
      processId: "proc-2",
      command: "pnpm build",
      stage: "Implementing",
      runtime: "cursor",
      timestamp: "2024-01-02T00:00:00Z",
    });

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-2",
      command: "pnpm build",
      stage: "Implementing",
      runtime: "cursor",
      startedAt: "2024-01-02T00:00:00Z",
    });
    expect(result.current.output).toBe("");
  });

  it("removes the process on a process:completed event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [activeProc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "x" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([activeProc]));

    fireSSE({ type: "process:completed", runId: "r1", processId: "proc-1" });

    await waitFor(() => expect(result.current.processes).toEqual([]));
  });

  it("appends output chunks on process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "r1", processId: "proc-1", chunk: "hello " });
    fireSSE({ type: "process:output", runId: "r1", processId: "proc-1", chunk: "world" });

    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("truncates buffered output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const big = "a".repeat(9000);
    fireSSE({ type: "process:output", runId: "r1", processId: "proc-1", chunk: big });
    fireSSE({ type: "process:output", runId: "r1", processId: "proc-1", chunk: "TAIL" });

    await waitFor(() => expect(result.current.output).toHaveLength(8192));
    expect(result.current.output.endsWith("TAIL")).toBe(true);
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "other-run", processId: "proc-x" });
    await Promise.resolve();
    expect(result.current.processes).toEqual([]);
  });
});
