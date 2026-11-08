import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";
import type { ActiveProcess } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
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

const RUN_ID = "run-1";

function makeProcess(id: string): ActiveProcess {
  return {
    id,
    pid: 123,
    command: "do-thing",
    runId: RUN_ID,
    stage: "executing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 10,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes, no output, and hasActive false", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and fetches output for the first one", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello output" });

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith(RUN_ID);
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    expect(result.current.output).toBe("hello output");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("does not request output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.processes).toEqual([]);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("silently tolerates getActiveProcesses failing (e.g. server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
  });

  it("silently tolerates getProcessOutput failing (process may have just ended)", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount while the initial fetch is still pending", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses(RUN_ID));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [makeProcess("p1")] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not update output after unmount while the process-output fetch is still pending", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("defaults id/command/stage/runtime to empty string when process:started omits them", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: RUN_ID });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("adds a process entry on process:started, derived from the event fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: RUN_ID,
        processId: "p2",
        command: "run-tests",
        stage: "reviewing",
        runtime: "codex",
        timestamp: "2024-02-02T00:00:00Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "run-tests",
      runId: RUN_ID,
      stage: "reviewing",
      runtime: "codex",
      startedAt: "2024-02-02T00:00:00Z",
      pid: 0,
      elapsedMs: 0,
    });
    expect(result.current.activeProcessId).toBe("p2");
    expect(result.current.hasActive).toBe(true);
  });

  it("resets output when a new process starts", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "old output" });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(result.current.output).toBe("old output"));

    act(() => {
      sseCallback!({ type: "process:started", runId: RUN_ID, processId: "p2" });
    });

    expect(result.current.output).toBe("");
  });

  it("removes the matching process on process:completed", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      sseCallback!({ type: "process:completed", runId: RUN_ID, processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: RUN_ID, chunk: "hello " });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: RUN_ID, chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: RUN_ID, chunk: "a".repeat(8000) });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: RUN_ID, chunk: "b".repeat(500) });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
  });

  it("ignores a process:output event with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: RUN_ID });
    });

    expect(result.current.output).toBe("");
  });
});
