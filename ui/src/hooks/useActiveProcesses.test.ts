import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

const sseHandlers: Array<(event: unknown) => void> = [];
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: unknown) => void) => {
    sseHandlers.push(handler);
  },
}));

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const sampleProcess = {
  id: "p1",
  pid: 123,
  command: "run-stage",
  runId: "r1",
  stage: "Executing",
  runtime: "claude",
  startedAt: "2026-01-01T00:00:00Z",
  elapsedMs: 10,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandlers.length = 0;
  });

  it("starts with empty processes, no active flag and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [sampleProcess] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "building..." });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([sampleProcess]));

    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    expect(result.current.output).toBe("building...");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("does not request output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("swallows an error fetching the process list (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows an error fetching process output (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [sampleProcess] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([sampleProcess]));

    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount while the initial fetch is in flight", async () => {
    let resolveFetch: (value: { processes: typeof sampleProcess[] }) => void = () => {};
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveFetch({ processes: [sampleProcess] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
  });

  it("adds a process on a process:started SSE event for the same run and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "lint",
        stage: "Reviewing",
        runtime: "codex",
        timestamp: "2026-02-02T00:00:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "lint",
        runId: "r1",
        stage: "Reviewing",
        runtime: "codex",
        startedAt: "2026-02-02T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("does not update output state after unmount while the output fetch is in flight", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [sampleProcess] });
    let resolveOutput: (value: { processId: string; output: string }) => void = () => {};
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1"));

    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("falls back to empty strings and a generated timestamp when process:started omits optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "process:started",
        runId: "r1",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    expect(typeof entry.startedAt).toBe("string");
    expect(entry.startedAt.length).toBeGreaterThan(0);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "process:started",
        runId: "other-run",
        processId: "p9",
      });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [sampleProcess] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([sampleProcess]));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "process:completed",
        runId: "r1",
        processId: "p1",
      });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [sampleProcess] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "start\n" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("start\n"));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "process:output",
        runId: "r1",
        chunk: "more output\n",
      });
    });

    expect(result.current.output).toBe("start\nmore output\n");
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [sampleProcess] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "a".repeat(8000) });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output.length).toBe(8000));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "process:output",
        runId: "r1",
        chunk: "b".repeat(500),
      });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
  });

  it("ignores a process:output event with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [sampleProcess] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "start" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("start"));

    act(() => {
      sseHandlers[sseHandlers.length - 1]!({
        type: "process:output",
        runId: "r1",
        chunk: "",
      });
    });

    expect(result.current.output).toBe("start");
  });
});
