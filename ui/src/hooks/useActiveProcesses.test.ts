import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const process1 = {
  id: "proc-1",
  pid: 123,
  command: "claude",
  runId: "run-1",
  stage: "implementing",
  runtime: "claude-code",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no active processes before the initial fetch resolves", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toEqual([]);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their buffered output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(result.current.output).toBe("hello");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("swallows a getProcessOutput failure for a process that already ended", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("swallows a getActiveProcesses failure (server restarting) and leaves an empty list", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("ECONNRESET"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("discards a stale response when the run id changes before the fetch resolves", async () => {
    let resolveFirst!: (v: { processes: typeof process1[] }) => void;
    mockApi.getActiveProcesses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { result, rerender } = renderHook(({ runId }) => useActiveProcesses(runId), {
      initialProps: { runId: "run-1" },
    });

    mockApi.getActiveProcesses.mockResolvedValueOnce({ processes: [] });
    rerender({ runId: "run-2" });

    await act(async () => {
      resolveFirst({ processes: [process1] });
      await Promise.resolve();
    });

    // The run-1 response must not populate state after we've moved to run-2.
    expect(result.current.processes).toEqual([]);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() =>
      sseCallback!({
        type: "process:started",
        runId: "other-run",
        processId: "proc-x",
      }),
    );

    expect(result.current.processes).toEqual([]);
  });

  it("adds a process on process:started and resets the output buffer", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() =>
      sseCallback!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "codex",
        stage: "reviewing",
        runtime: "codex",
      }),
    );

    expect(result.current.processes).toEqual([
      {
        id: "proc-2",
        pid: 0,
        command: "codex",
        runId: "run-1",
        stage: "reviewing",
        runtime: "codex",
        startedAt: expect.any(String),
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
  });

  it("appends chunks on process:output and truncates the buffer past 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() =>
      sseCallback!({ type: "process:output", runId: "run-1", chunk: "a".repeat(8000) }),
    );
    expect(result.current.output).toHaveLength(8000);

    act(() =>
      sseCallback!({ type: "process:output", runId: "run-1", chunk: "b".repeat(500) }),
    );
    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
  });

  it("ignores a process:output event with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => sseCallback!({ type: "process:output", runId: "run-1", chunk: "" }));
    expect(result.current.output).toBe("");
  });

  it("removes a process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    act(() =>
      sseCallback!({ type: "process:completed", runId: "run-1", processId: "proc-1" }),
    );

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("cancels the in-flight initial fetch on unmount without updating state", async () => {
    let resolveFn!: (v: { processes: typeof process1[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveFn({ processes: [process1] });
      await Promise.resolve();
    });
    // No assertion target after unmount other than "did not throw" — React
    // would warn on a state update after unmount if the cancellation guard
    // were missing.
  });
});
