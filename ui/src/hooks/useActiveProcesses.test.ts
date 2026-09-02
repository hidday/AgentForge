import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";
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
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEventSource.instances.push(this);
  }
}

function emit(source: FakeEventSource, event: Record<string, unknown>) {
  act(() => {
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
  });
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
    vi.resetAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty, inactive state when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads processes and fetches output for the first active process", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "log output" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
    expect(result.current.output).toBe("log output");
    expect(result.current.activeProcessId).toBe(proc.id);
    expect(result.current.processes).toEqual([proc]);
  });

  it("swallows an error fetching the initial process list", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows an error fetching output for a process that just ended", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount (cancelled init)", async () => {
    let resolveList!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveList = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveList({ processes: [makeProcess()] });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("does not apply output once unmounted while the output fetch is still pending", async () => {
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
      resolveOutput({ processId: proc.id, output: "too late" });
    });

    expect(result.current.output).toBe("");
  });

  it("re-fetches when the runId changes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { rerender } = renderHook(({ id }) => useActiveProcesses(id), {
      initialProps: { id: "run-1" },
    });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    rerender({ id: "run-2" });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-2"));
  });

  it("adds a process and resets output on a process:started event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    const source = FakeEventSource.instances[0]!;
    emit(source, {
      type: "process:started",
      runId: "run-1",
      processId: "proc-9",
      command: "pnpm build",
      stage: "Implementing",
      runtime: "claude",
      timestamp: "2024-02-02T00:00:00Z",
    });

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes[0]).toEqual({
      id: "proc-9",
      pid: 0,
      command: "pnpm build",
      runId: "run-1",
      stage: "Implementing",
      runtime: "claude",
      startedAt: "2024-02-02T00:00:00Z",
      elapsedMs: 0,
    });
    expect(result.current.output).toBe("");
  });

  it("fills in defaults and a generated timestamp when process:started fields are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "process:started", runId: "run-1" });

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    const p = result.current.processes[0]!;
    expect(p.id).toBe("");
    expect(p.command).toBe("");
    expect(p.stage).toBe("");
    expect(p.runtime).toBe("");
    expect(typeof p.startedAt).toBe("string");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "process:started", runId: "run-2", processId: "proc-9" });

    expect(result.current.hasActive).toBe(false);
  });

  it("removes a process on a process:completed event", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "process:completed", runId: "run-1", processId: proc.id });

    await waitFor(() => expect(result.current.hasActive).toBe(false));
    expect(result.current.processes).toEqual([]);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "process:output", runId: "run-1", chunk: "hello " });
    emit(source, { type: "process:output", runId: "run-1", chunk: "world" });

    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("ignores a process:output event with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "process:output", runId: "run-1", chunk: "" });

    expect(result.current.output).toBe("");
  });

  it("trims the output buffer to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    const chunkA = "a".repeat(5000);
    const chunkB = "b".repeat(5000);
    emit(source, { type: "process:output", runId: "run-1", chunk: chunkA });
    emit(source, { type: "process:output", runId: "run-1", chunk: chunkB });

    await waitFor(() => expect(result.current.output.length).toBe(8192));
    // 5000 'a's + 5000 'b's = 10000 chars, sliced to the last 8192: the
    // trailing 3192 'a's plus all 5000 'b's — the leading 1808 'a's are gone.
    expect(result.current.output.endsWith("b".repeat(5000))).toBe(true);
    expect(result.current.output.startsWith("a".repeat(3192))).toBe(true);
    expect(result.current.output.includes("a".repeat(3193))).toBe(false);
  });
});
