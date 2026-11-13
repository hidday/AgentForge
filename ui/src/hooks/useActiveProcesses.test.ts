import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api, type ActiveProcess } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor() {
    MockEventSource.instances.push(this);
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "npm test",
    runId: "r1",
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
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with no processes, no output, and hasActive false", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("r1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and leaves output empty when there are none", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
    expect(result.current.processes).toEqual([]);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("fetches output for the first active process on load", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "building..." });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.output).toBe("building..."));
    expect(result.current.processes).toEqual([proc]);
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("leaves output empty if fetching process output fails (process may have just ended)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.output).toBe("");
  });

  it("silently tolerates the initial processes fetch failing (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("502"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends a new process and resets output on a process:started event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      MockEventSource.instances[0]!.emit({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "pytest",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2024-02-01T00:00:00Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "pytest",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2024-02-01T00:00:00Z",
    });
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("ignores process:started events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      MockEventSource.instances[0]!.emit({
        type: "process:started",
        runId: "other-run",
        processId: "p2",
      });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on a process:completed event matching its id", async () => {
    const proc = makeProcess({ id: "p1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      MockEventSource.instances[0]!.emit({
        type: "process:completed",
        runId: "r1",
        processId: "p1",
      });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks from process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      MockEventSource.instances[0]!.emit({ type: "process:output", runId: "r1", chunk: "hello " });
    });
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "process:output", runId: "r1", chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "process:output", runId: "r1", chunk: bigChunk });
    });
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "process:output", runId: "r1", chunk: bigChunk });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("a")).toBe(true);
  });

  it("ignores a process:output event with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      MockEventSource.instances[0]!.emit({ type: "process:output", runId: "r1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount when the initial fetch resolves late", async () => {
    let resolveFn!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    expect(() => {
      act(() => {
        resolveFn({ processes: [makeProcess()] });
      });
    }).not.toThrow();
  });

  it("closes its SSE connection on unmount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const closeSpy = vi.spyOn(MockEventSource.instances[0]!, "close");
    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });
});
