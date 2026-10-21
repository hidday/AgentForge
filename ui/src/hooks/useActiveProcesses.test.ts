import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("./useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("./useSSE.ts")>("./useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const proc = {
  id: "proc-1",
  pid: 123,
  command: "cursor-agent",
  runId: "run-1",
  stage: "executor",
  runtime: "cursor",
  startedAt: "2026-01-01T00:00:00Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no active processes and empty output", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads existing processes and the first process's output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValueOnce({ processId: proc.id, output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
    expect(result.current.output).toBe("hello");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc.id);
  });

  it("silently ignores a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValueOnce(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.output).toBe("");
  });

  it("silently ignores a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValueOnce(new Error("503"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("does not update state after unmount (cancelled guard)", async () => {
    let resolveFetch: (v: { processes: typeof proc[] }) => void = () => {};
    mockApi.getActiveProcesses.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveFetch({ processes: [proc] });
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
  });

  it("does not set output after unmount even if getProcessOutput resolves late (cancelled guard)", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    let resolveOutput: (v: { processId: string; output: string }) => void = () => {};
    mockApi.getProcessOutput.mockImplementationOnce(
      () => new Promise((resolve) => { resolveOutput = resolve; }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    unmount();

    await act(async () => {
      resolveOutput({ processId: proc.id, output: "late output" });
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("falls back to defaults when process:started fields are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback?.({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes).toEqual([
      {
        id: "",
        pid: 0,
        command: "",
        runId: "run-1",
        stage: "",
        runtime: "",
        startedAt: expect.any(String),
        elapsedMs: 0,
      },
    ]);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback?.({ type: "process:started", runId: "other-run", processId: "x" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("adds a process entry and resets output on process:started", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback?.({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "codex",
        stage: "executor",
        runtime: "codex",
        timestamp: "2026-01-02T00:00:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "proc-2",
        pid: 0,
        command: "codex",
        runId: "run-1",
        stage: "executor",
        runtime: "codex",
        startedAt: "2026-01-02T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
  });

  it("removes the process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValueOnce({ processId: proc.id, output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      sseCallback?.({ type: "process:completed", runId: "run-1", processId: proc.id });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("appends output chunks on process:output", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "hello " });
    });
    act(() => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("ignores process:output events with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("trims accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "a".repeat(5000) });
    });
    act(() => {
      sseCallback?.({ type: "process:output", runId: "run-1", chunk: "b".repeat(5000) });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("b".repeat(5000))).toBe(true);
  });
});
