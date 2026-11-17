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

const sseCallback: { current: ((event: DashboardEvent) => void) | null } = { current: null };
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback.current = cb;
  },
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "codex",
    runId: "run-1",
    stage: "executor",
    runtime: "codex",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback.current = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with no active processes when none exist on the server", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("loads the active process and its current output on mount", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello\n" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
    expect(result.current.output).toBe("hello\n");
    expect(result.current.activeProcessId).toBe(proc.id);
  });

  it("silently swallows a getProcessOutput failure (process may have just ended)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("silently swallows a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("restarting"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not update state after unmount even if the pending fetch resolves later", async () => {
    let resolveFetch!: (value: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveFetch({ processes: [makeProcess()] });
      await Promise.resolve();
    });
    // No crash and no React "update after unmount" warning is the assertion here.
  });

  it("adds a process on process:started, resets output, and ignores events for other runs", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    act(() =>
      sseCallback.current!({
        type: "process:started",
        runId: "other-run",
        processId: "proc-x",
      }),
    );
    expect(result.current.processes).toEqual([]);

    act(() =>
      sseCallback.current!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "claude",
        stage: "planner",
        runtime: "claude",
      }),
    );

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-2");
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-2",
      command: "claude",
      stage: "planner",
      runtime: "claude",
      runId: "run-1",
    });
    expect(result.current.output).toBe("");
  });

  it("removes a process on process:completed", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    act(() =>
      sseCallback.current!({ type: "process:started", runId: "run-1", processId: "proc-2" }),
    );
    expect(result.current.hasActive).toBe(true);

    act(() =>
      sseCallback.current!({ type: "process:completed", runId: "run-1", processId: "proc-2" }),
    );
    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toEqual([]);
  });

  it("appends output chunks on process:output and truncates beyond 8192 characters", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    act(() =>
      sseCallback.current!({ type: "process:output", runId: "run-1", chunk: "abc" }),
    );
    expect(result.current.output).toBe("abc");

    const bigChunk = "x".repeat(9000);
    act(() =>
      sseCallback.current!({ type: "process:output", runId: "run-1", chunk: bigChunk }),
    );
    expect(result.current.output.length).toBe(8192);
    expect(result.current.output).toBe(("abc" + bigChunk).slice(-8192));
  });

  it("ignores a process:output event with an empty chunk", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    act(() => sseCallback.current!({ type: "process:output", runId: "run-1", chunk: "" }));
    expect(result.current.output).toBe("");
  });
});
