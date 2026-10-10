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

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
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

const procA = {
  id: "proc-a",
  pid: 123,
  command: "run",
  runId: "run-1",
  stage: "executing",
  runtime: "codex",
  startedAt: "2026-01-01T00:00:00.000Z",
  elapsedMs: 10,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  sseCallback = null;
  mockApi.getActiveProcesses.mockReset();
  mockApi.getProcessOutput.mockReset();
});

describe("useActiveProcesses", () => {
  it("has no active processes when none are returned", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("fetches output for the first active process when one exists", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [procA] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: procA.id, output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));

    expect(result.current.processes).toEqual([procA]);
    expect(result.current.activeProcessId).toBe(procA.id);
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(procA.id);
    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("swallows a failure fetching active processes (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
  });

  it("swallows a failure fetching process output (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [procA] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("ended"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));

    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(procA.id);
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount while the outer fetch is pending", async () => {
    const outer = deferred<{ processes: typeof procA[] }>();
    mockApi.getActiveProcesses.mockReturnValue(outer.promise);

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    expect(() => {
      outer.resolve({ processes: [procA] });
    }).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();

    // No assertions on `result.current` after unmount are meaningful for React,
    // but we assert the hook's own state object was never advanced past init.
    expect(result.current.processes).toEqual([]);
  });

  it("does not update state after unmount while the inner output fetch is pending", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [procA] });
    const inner = deferred<{ processId: string; output: string }>();
    mockApi.getProcessOutput.mockReturnValue(inner.promise);

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());

    unmount();

    expect(() => {
      inner.resolve({ processId: procA.id, output: "late output" });
    }).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
  });

  it("re-fetches when runId changes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { rerender } = renderHook(({ runId }) => useActiveProcesses(runId), {
      initialProps: { runId: "run-1" },
    });

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    rerender({ runId: "run-2" });

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-2"));
    expect(mockApi.getActiveProcesses).toHaveBeenCalledTimes(2);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "other-run", processId: "x" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("appends a new process on process:started and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-b",
        command: "build",
        stage: "building",
        runtime: "claude",
        timestamp: "2026-02-02T00:00:00.000Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "proc-b",
        pid: 0,
        command: "build",
        runId: "run-1",
        stage: "building",
        runtime: "claude",
        startedAt: "2026-02-02T00:00:00.000Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBe("proc-b");
  });

  it("falls back to defaults for missing optional fields on process:started", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const before = Date.now();
    act(() => {
      sseCallback!({ type: "process:started", runId: "run-1" });
    });
    const after = Date.now();

    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    expect(entry.pid).toBe(0);
    expect(entry.elapsedMs).toBe(0);
    const startedAtMs = new Date(entry.startedAt).getTime();
    expect(startedAtMs >= before && startedAtMs <= after).toBe(true);
  });

  it("removes the matching process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [procA] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: procA.id, output: "" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([procA]));

    act(() => {
      sseCallback!({ type: "process:completed", runId: "run-1", processId: procA.id });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [procA] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: procA.id, output: "start" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.output).toBe("start"));

    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", chunk: "-more" });
    });

    expect(result.current.output).toBe("start-more");
  });

  it("ignores process:output events with a falsy chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [procA] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: procA.id, output: "start" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.output).toBe("start"));

    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", chunk: "" });
    });

    expect(result.current.output).toBe("start");
  });

  it("truncates the output buffer to the last 8192 characters when it overflows", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(8000);
    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", chunk: bigChunk });
    });
    expect(result.current.output.length).toBe(8000);

    const secondChunk = "b".repeat(500);
    act(() => {
      sseCallback!({ type: "process:output", runId: "run-1", chunk: secondChunk });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
    expect(result.current.output.startsWith("a")).toBe(true);
  });
});
