import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function getRegisteredHandler() {
  return mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1][0] as (event: {
    type: string;
    runId: string;
    [k: string]: unknown;
  }) => void;
}

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "claude",
    runId: "r1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts empty and reports hasActive=false / activeProcessId=null before data loads", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
  });

  it("loads processes and fetches output for the first active process", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "line 1\nline 2" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(result.current.output).toBe("line 1\nline 2"));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("swallows getActiveProcesses failures and leaves processes empty (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows getProcessOutput failures and keeps the process list without output", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("appends a new process and resets output on 'process:started'", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getRegisteredHandler();
    act(() => {
      handler({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "claude run",
        stage: "Implementing",
        runtime: "claude-code",
        timestamp: "2024-02-02T00:00:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "claude run",
        runId: "r1",
        stage: "Implementing",
        runtime: "claude-code",
        startedAt: "2024-02-02T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("fills in sensible defaults when optional fields are missing from 'process:started'", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "process:started", runId: "r1" });
    });

    const added = result.current.processes[0]!;
    expect(added.id).toBe("");
    expect(added.command).toBe("");
    expect(added.stage).toBe("");
    expect(added.runtime).toBe("");
    expect(typeof added.startedAt).toBe("string");
  });

  it("removes the matching process on 'process:completed'", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on 'process:output'", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "hello " });
    });
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "a".repeat(8000) });
    });
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "b".repeat(300) });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(300))).toBe(true);
  });

  it("ignores a 'process:output' event with an empty/falsy chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getRegisteredHandler();
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });
});
