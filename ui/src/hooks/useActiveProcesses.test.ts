import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEventSource.instances.push(this);
  }
}

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
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with empty processes, no active process, and no output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads processes and fetches output for the first active process", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello output" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc.id);
    await waitFor(() => expect(result.current.output).toBe("hello output"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
  });

  it("does not call getProcessOutput when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.processes).toEqual([]);
  });

  it("swallows getActiveProcesses errors (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("swallows getProcessOutput errors (process may have just ended)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    expect(result.current.output).toBe("");
  });

  it("adds a process and resets output on an SSE process:started event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({
          type: "process:started",
          runId: "run-1",
          processId: "proc-9",
          command: "npm build",
          stage: "Implementing",
          runtime: "claude",
          timestamp: "2024-02-01T00:00:00Z",
        }),
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-9",
      command: "npm build",
      runId: "run-1",
    });
    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:started", runId: "run-OTHER", processId: "proc-9" }),
      });
    });

    expect(result.current.processes).toHaveLength(0);
  });

  it("removes a process on an SSE process:completed event", async () => {
    const proc = makeProcess({ id: "proc-1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:completed", runId: "run-1", processId: "proc-1" }),
      });
    });

    expect(result.current.processes).toHaveLength(0);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends chunks on SSE process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: "line 1\n" }),
      });
    });
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: "line 2\n" }),
      });
    });

    expect(result.current.output).toBe("line 1\nline 2\n");
  });

  it("truncates output to the last 8192 characters when it grows too large", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0];
    const bigChunk = "a".repeat(9000);
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: bigChunk }),
      });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output).toBe("a".repeat(8192));
  });

  it("uses fallback empty values when a process:started event omits optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:started", runId: "run-1" }),
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0].startedAt).toBe("string");
    expect(result.current.processes[0].startedAt.length).toBeGreaterThan(0);
  });

  it("does not update state after unmount while the initial process list fetch is still pending", async () => {
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

    // No assertion errors / warnings should occur from setting state on an unmounted hook;
    // the cancelled guard prevents that state update entirely.
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("does not update output after unmount while the process output fetch is still pending", async () => {
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

    expect(result.current.output).toBe("");
  });

  it("ignores process:output events without a chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0];
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:output", runId: "run-1" }),
      });
    });

    expect(result.current.output).toBe("");
  });
});
