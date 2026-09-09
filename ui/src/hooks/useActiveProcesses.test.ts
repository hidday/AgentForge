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

function latestSSEHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2026-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts empty and stays empty when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads processes and fetches output for the first process on mount", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc.id);
    await waitFor(() => expect(result.current.output).toBe("hello world"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
  });

  it("swallows a getProcessOutput failure (process may have just ended)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.output).toBe("");
  });

  it("swallows a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("adds a process and resets output on a process:started event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({
        type: "process:started",
        runId: "run-1",
        processId: "proc-new",
        command: "pnpm test",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2026-01-01T00:05:00Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "proc-new",
      command: "pnpm test",
      stage: "Implementing",
      runtime: "claude",
      runId: "run-1",
    });
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("fills in defaults for a process:started event missing optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      pid: 0,
      command: "",
      stage: "",
      runtime: "",
      elapsedMs: 0,
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("removes a process on a process:completed event", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      latestSSEHandler()({ type: "process:completed", runId: "run-1", processId: proc.id });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends chunks to output on process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "run-1", chunk: "hello " });
    });
    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "run-1", chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(9000);
    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "run-1", chunk: bigChunk });
    });

    expect(result.current.output).toHaveLength(8192);
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({
        type: "process:started",
        runId: "other-run",
        processId: "proc-x",
      });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("does not update state after unmount when getActiveProcesses resolves late (cancelled guard)", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolve after unmount; the `cancelled` guard should prevent any state update / crash.
    await act(async () => {
      resolveProcesses({ processes: [makeProcess()] });
    });
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("does not update state after unmount when getProcessOutput resolves late (cancelled guard)", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    unmount();

    await act(async () => {
      resolveOutput({ processId: proc.id, output: "late output" });
    });
    // No assertion on `result.current` after unmount is meaningful beyond "did not throw";
    // the cancelled guard exists precisely to make this a safe no-op.
  });

  it("ignores a process:output event with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "run-1" });
    });

    expect(result.current.output).toBe("");
  });
});
