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

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    MockEventSource.instances.push(this);
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!source) throw new Error("no EventSource instance created");
  return source;
}

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "npm test",
    runId: "run-1",
    stage: "executing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  mockApi.getActiveProcesses.mockReset();
  mockApi.getProcessOutput.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useActiveProcesses", () => {
  it("starts empty and reflects no active process when none are returned", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("fetches output for the first active process and exposes it", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));

    expect(result.current.processes).toEqual([proc]);
    expect(result.current.activeProcessId).toBe(proc.id);
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("swallows an error from getActiveProcesses and leaves state empty", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
  });

  it("swallows an error from getProcessOutput, keeping the process but empty output", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());

    expect(result.current.output).toBe("");
    expect(result.current.processes).toEqual([proc]);
  });

  it("does not update state after unmount (cancelled init effect)", async () => {
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

    // Nothing to assert on `result.current` post-unmount via the hook itself,
    // but getProcessOutput must never have been triggered since init bailed out.
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.processes).toEqual([]);
  });

  it("does not update output after unmount while getProcessOutput is still pending", async () => {
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

  it("process:started SSE event adds a new process entry and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({
          type: "process:started",
          runId: "run-1",
          processId: "proc-9",
          command: "pnpm build",
          stage: "building",
          runtime: "claude",
          timestamp: "2024-02-02T00:00:00Z",
        }),
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-9",
      pid: 0,
      command: "pnpm build",
      runId: "run-1",
      stage: "building",
      runtime: "claude",
      startedAt: "2024-02-02T00:00:00Z",
      elapsedMs: 0,
    });
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-9");
    expect(result.current.output).toBe("");
  });

  it("process:started event fills in defaults when optional fields are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:started", runId: "run-1" }),
      });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("process:completed SSE event removes the matching process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:started", runId: "run-1", processId: "proc-9" }),
      });
    });
    expect(result.current.processes).toHaveLength(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:completed", runId: "run-1", processId: "proc-9" }),
      });
    });

    expect(result.current.processes).toHaveLength(0);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("process:output SSE event appends chunks to the output buffer", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: "foo" }),
      });
    });
    expect(result.current.output).toBe("foo");

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: "bar" }),
      });
    });
    expect(result.current.output).toBe("foobar");
  });

  it("process:output events with an empty chunk do not modify the output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: "" }),
      });
    });

    expect(result.current.output).toBe("");
  });

  it("truncates the output buffer to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const chunkA = "a".repeat(5000);
    const chunkB = "b".repeat(5000);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: chunkA }),
      });
    });
    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "process:output", runId: "run-1", chunk: chunkB }),
      });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith(chunkB)).toBe(true);
    expect(result.current.output.startsWith("a")).toBe(true);
    expect(result.current.output.includes("b".repeat(5000))).toBe(true);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({
          type: "process:started",
          runId: "other-run",
          processId: "proc-9",
        }),
      });
    });

    expect(result.current.processes).toHaveLength(0);
  });

  it("closes its SSE subscription on unmount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const source = latestSource();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
