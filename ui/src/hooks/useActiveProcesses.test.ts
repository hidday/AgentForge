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
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { useActiveProcesses } from "./useActiveProcesses";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(id: string): ActiveProcess {
  return {
    id,
    pid: 123,
    command: "npm test",
    runId: "r1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2026-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with empty state and no active process", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "running..." });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("running..."));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("does not request output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("silently tolerates getActiveProcesses failing (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("silently tolerates getProcessOutput failing (process just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    // Output request failed, so output remains the initial empty string.
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmounting while getActiveProcesses is still pending", async () => {
    let resolveFetch!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveFetch({ processes: [makeProcess("p1")] });
    });
    // No assertion needed beyond "did not throw" — the cancelled guard
    // prevents calling setState on an unmounted component.
  });

  it("does not update state after unmounting while getProcessOutput is still pending", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
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
    });
  });

  it("falls back to empty-string/default fields when a process:started event is missing optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.processes).toHaveLength(1);
    const proc = result.current.processes[0]!;
    expect(proc.id).toBe("");
    expect(proc.command).toBe("");
    expect(proc.stage).toBe("");
    expect(proc.runtime).toBe("");
    expect(typeof proc.startedAt).toBe("string");
    expect(proc.startedAt.length).toBeGreaterThan(0);
  });

  it("adds a process on a process:started SSE event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: "r1",
        processId: "p1",
        command: "npm run build",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2026-01-01T00:01:00Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p1",
      command: "npm run build",
      runId: "r1",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2026-01-01T00:01:00Z",
      elapsedMs: 0,
    });
    expect(result.current.hasActive).toBe(true);
    // Output is reset when a new process starts.
    expect(result.current.output).toBe("");
  });

  it("ignores a process:started SSE event for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "other-run", processId: "p1" });
    });

    expect(result.current.processes).toHaveLength(0);
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toHaveLength(1));

    act(() => {
      sseCallback!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toHaveLength(0);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks from process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "start\n" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("start\n"));

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", processId: "p1", chunk: "more\n" });
    });

    expect(result.current.output).toBe("start\nmore\n");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", processId: "p1", chunk: "a".repeat(5000) });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", processId: "p1", chunk: "b".repeat(5000) });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(5000))).toBe(true);
  });

  it("ignores a process:output event with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", processId: "p1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("re-fetches when runId changes, discarding the previous run's processes", async () => {
    mockApi.getActiveProcesses.mockImplementation((runId?: string) =>
      Promise.resolve({ processes: runId === "r2" ? [makeProcess("p2")] : [] }),
    );

    const { result, rerender } = renderHook(({ runId }: { runId: string }) => useActiveProcesses(runId), {
      initialProps: { runId: "r1" },
    });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));

    rerender({ runId: "r2" });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r2"));
    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.processes[0]!.id).toBe("p2");
  });
});
