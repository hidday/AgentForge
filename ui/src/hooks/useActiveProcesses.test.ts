import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

import { api, type ActiveProcess } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: DashboardEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  }
}

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 111,
    command: "npm test",
    runId: "run-1",
    stage: "executor",
    runtime: "node",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    originalEventSource = (global as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (global as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it("starts with no processes and empty output before the fetch resolves", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();

    await act(async () => {
      resolveProcesses({ processes: [] });
    });
  });

  it("loads active processes and their output", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
    await waitFor(() => expect(result.current.output).toBe("hello world"));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc.id);
  });

  it("keeps output empty when fetching process output fails (process may have just ended)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.output).toBe("");
  });

  it("keeps processes empty when the initial fetch fails (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not call getProcessOutput when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.processes).toEqual([]);
  });

  it("ignores a stale getActiveProcesses resolution after unmount", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [makeProcess()] });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Unmounted before resolution, so the cancelled guard must have skipped setProcesses;
    // the last rendered state (initial, empty) is what result.current still reflects.
    expect(result.current.processes).toEqual([]);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("ignores a stale getProcessOutput resolution after unmount", async () => {
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
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("adds a process on a process:started SSE event scoped to this run, resetting output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({
        type: "process:started",
        runId: "run-1",
        processId: "proc-9",
        command: "pnpm build",
        stage: "reviewer",
        runtime: "bun",
        timestamp: "2024-05-01T00:00:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "proc-9",
        pid: 0,
        command: "pnpm build",
        runId: "run-1",
        stage: "reviewer",
        runtime: "bun",
        startedAt: "2024-05-01T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
  });

  it("falls back to empty-string defaults and a generated timestamp when process:started omits optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes).toHaveLength(1);
    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    expect(entry.pid).toBe(0);
    expect(typeof entry.startedAt).toBe("string");
    expect(entry.startedAt.length).toBeGreaterThan(0);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "process:started", runId: "other-run", processId: "x" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on process:completed", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "process:completed", runId: "run-1", processId: proc.id });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks from process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "process:output", runId: "run-1", chunk: "hello " });
    });
    act(() => {
      source.emit({ type: "process:output", runId: "run-1", chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("ignores process:output events without a chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "process:output", runId: "run-1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("truncates output to the last 8192 characters when it grows too large", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    const big = "a".repeat(5000);
    act(() => {
      source.emit({ type: "process:output", runId: "run-1", chunk: big });
    });
    act(() => {
      source.emit({ type: "process:output", runId: "run-1", chunk: big });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output).toBe((big + big).slice(-8192));
  });

  it("closes the SSE connection on unmount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    unmount();

    expect(source.closed).toBe(true);
  });

  it("refetches for the new runId when runId changes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { rerender } = renderHook(({ runId }) => useActiveProcesses(runId), {
      initialProps: { runId: "run-1" },
    });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    rerender({ runId: "run-2" });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-2"));
  });
});
