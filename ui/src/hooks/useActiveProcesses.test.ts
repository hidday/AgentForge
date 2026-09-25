import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api, type ActiveProcess } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  }),
}));

const mockedGetActiveProcesses = vi.mocked(api.getActiveProcesses);
const mockedGetProcessOutput = vi.mocked(api.getProcessOutput);

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "run-thing",
    runId: "r1",
    stage: "executing",
    runtime: "codex",
    startedAt: "2026-01-01T00:00:00.000Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    sseHandler = null;
    mockedGetActiveProcesses.mockReset();
    mockedGetProcessOutput.mockReset();
  });

  it("starts with empty processes, no active process, and empty output", async () => {
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();

    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalledWith("r1"));
  });

  it("loads active processes and their output on mount", async () => {
    const proc = makeProcess();
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    mockedGetProcessOutput.mockResolvedValueOnce({
      processId: proc.id,
      output: "hello world",
    });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello world"));
    expect(mockedGetProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("silently ignores a failure fetching the process list", async () => {
    mockedGetActiveProcesses.mockRejectedValueOnce(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("silently ignores a failure fetching process output when the process just ended", async () => {
    const proc = makeProcess();
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    mockedGetProcessOutput.mockRejectedValueOnce(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    await waitFor(() => expect(mockedGetProcessOutput).toHaveBeenCalled());
    expect(result.current.output).toBe("");
  });

  it("does not apply the initial fetch results after unmount", async () => {
    let resolveProcesses!: (value: { processes: ActiveProcess[] }) => void;
    mockedGetActiveProcesses.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProcesses = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    resolveProcesses({ processes: [makeProcess()] });
    // Flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.processes).toEqual([]);
  });

  it("does not apply process output fetched after unmount", async () => {
    const proc = makeProcess();
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    let resolveOutput!: (value: { processId: string; output: string }) => void;
    mockedGetProcessOutput.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    unmount();
    resolveOutput({ processId: proc.id, output: "late output" });
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.output).toBe("");
  });

  it("fills in defaults for a process:started SSE event missing optional fields", async () => {
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalled());

    const before = Date.now();
    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });
    const after = Date.now();

    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    const startedAtMs = new Date(entry.startedAt).getTime();
    expect(startedAtMs).toBeGreaterThanOrEqual(before);
    expect(startedAtMs).toBeLessThanOrEqual(after);
  });

  it("adds a process on a process:started SSE event and resets output", async () => {
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "do-thing",
        stage: "planning",
        runtime: "claude",
        timestamp: "2026-02-01T00:00:00.000Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "do-thing",
        runId: "r1",
        stage: "planning",
        runtime: "claude",
        startedAt: "2026-02-01T00:00:00.000Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("ignores SSE events for a different run", async () => {
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:started", runId: "other", processId: "p2" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on a process:completed SSE event", async () => {
    const proc = makeProcess({ id: "p1" });
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    mockedGetProcessOutput.mockResolvedValueOnce({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      sseHandler!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output SSE events", async () => {
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", processId: "p1", chunk: "hello " });
    });
    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", processId: "p1", chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("ignores process:output events with an empty chunk", async () => {
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", processId: "p1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockedGetActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockedGetActiveProcesses).toHaveBeenCalled());

    const firstChunk = "a".repeat(8000);
    const secondChunk = "b".repeat(500);

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", processId: "p1", chunk: firstChunk });
    });
    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", processId: "p1", chunk: secondChunk });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
    expect(result.current.output.startsWith("a")).toBe(true);
  });
});
