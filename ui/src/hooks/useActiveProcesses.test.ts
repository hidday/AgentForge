import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";
import type { ActiveProcess } from "@/api/client.ts";

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
  if (!sseCallback) throw new Error("SSE callback not registered");
  act(() => sseCallback!(event));
}

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "echo hi",
    runId: "run-1",
    stage: "executing",
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

  it("stays empty when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads output for the first active process on init", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.output).toBe("hello"));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc.id);
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
  });

  it("swallows a getProcessOutput failure (process may have just ended)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    expect(result.current.output).toBe("");
    expect(result.current.processes).toEqual([proc]);
  });

  it("swallows a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
  });

  it("does not apply late init results after unmount", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [makeProcess()] });
      await Promise.resolve();
    });
    // No assertion needed beyond "no crash" — the cancelled flag prevents
    // setState-after-unmount from running.
  });

  it("does not apply a late getProcessOutput result after unmount", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });

    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());

    unmount();

    await act(async () => {
      resolveOutput({ processId: proc.id, output: "late output" });
      await Promise.resolve();
    });

    // The cancelled flag must stop the second setOutput from firing.
    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "run-other", processId: "p9" });
    expect(result.current.processes).toEqual([]);
  });

  it("adds a process entry on process:started and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({
      type: "process:started",
      runId: "run-1",
      processId: "p1",
      command: "run tests",
      stage: "executing",
      runtime: "claude",
      timestamp: "2024-02-02T00:00:00Z",
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p1",
      pid: 0,
      command: "run tests",
      runId: "run-1",
      stage: "executing",
      runtime: "claude",
      startedAt: "2024-02-02T00:00:00Z",
      elapsedMs: 0,
    });
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("fills in defaults on process:started when optional fields are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "run-1" });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("removes the matching process on process:completed", async () => {
    const proc = makeProcess({ id: "p1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toHaveLength(1));

    fireSSE({ type: "process:completed", runId: "run-1", processId: "p1" });
    expect(result.current.processes).toHaveLength(0);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "run-1", chunk: "hello " });
    fireSSE({ type: "process:output", runId: "run-1", chunk: "world" });

    expect(result.current.output).toBe("hello world");
  });

  it("ignores process:output events with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "run-1" });
    expect(result.current.output).toBe("");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    fireSSE({ type: "process:output", runId: "run-1", chunk: bigChunk });
    fireSSE({ type: "process:output", runId: "run-1", chunk: bigChunk });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output).toBe("a".repeat(8192));
  });
});
