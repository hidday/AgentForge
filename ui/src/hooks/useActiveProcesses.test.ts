import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

const process1 = {
  id: "proc-1",
  pid: 123,
  command: "npm test",
  runId: "run-1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2026-01-01T00:00:00.000Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with no processes, no active flag, and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(result.current.output).toBe("hello");
  });

  it("does not request process output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("swallows errors from getActiveProcesses without throwing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows errors from getProcessOutput, leaving output empty", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([process1]));
    expect(result.current.output).toBe("");
  });

  it("adds a process and resets output on a process:started SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({
          type: "process:started",
          runId: "run-1",
          processId: "proc-2",
          command: "pnpm build",
          stage: "Implementing",
          runtime: "claude",
          timestamp: "2026-01-02T00:00:00.000Z",
        }),
      });
    });

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-2",
      command: "pnpm build",
      runId: "run-1",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toHaveLength(1));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({
          type: "process:completed",
          runId: "run-1",
          processId: "proc-1",
        }),
      });
    });

    await waitFor(() => expect(result.current.processes).toHaveLength(0));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "start\n" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.output).toBe("start\n"));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({
          type: "process:output",
          runId: "run-1",
          chunk: "more output",
        }),
      });
    });

    await waitFor(() => expect(result.current.output).toBe("start\nmore output"));
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    const bigChunk = "a".repeat(5000);

    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: bigChunk }),
      });
    });
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: bigChunk }),
      });
    });

    await waitFor(() => expect(result.current.output.length).toBe(8192));
    expect(result.current.output.endsWith("a")).toBe(true);
  });

  it("fills in fallback values when a process:started event omits optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:started", runId: "run-1" }),
      });
    });

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    const [proc] = result.current.processes;
    expect(proc!.id).toBe("");
    expect(proc!.command).toBe("");
    expect(proc!.stage).toBe("");
    expect(proc!.runtime).toBe("");
    expect(typeof proc!.startedAt).toBe("string");
    expect(proc!.startedAt.length).toBeGreaterThan(0);
  });

  it("discards the initial fetch result if the hook unmounts before it resolves", async () => {
    let resolveProcesses: (v: { processes: typeof process1[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses!({ processes: [process1] });
      await Promise.resolve();
    });

    // State updates after unmount are discarded by the `cancelled` guard.
    expect(result.current.processes).toEqual([]);
  });

  it("discards the process-output fetch result if the hook unmounts before it resolves", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    let resolveOutput: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveOutput!({ processId: "proc-1", output: "late output" });
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({
          type: "process:started",
          runId: "other-run",
          processId: "proc-9",
        }),
      });
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.processes).toHaveLength(0);
  });

  it("closes the SSE connection when the hook unmounts", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
