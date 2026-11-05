import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

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

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

const PROC = {
  id: "proc-1",
  pid: 123,
  command: "npm test",
  runId: "run-1",
  stage: "execute",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 10,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no active processes and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "building..." });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes).toEqual([PROC]);
    expect(result.current.output).toBe("building...");
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("does not call getProcessOutput when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("swallows a getActiveProcesses failure (server restarting) without throwing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    // No crash; state stays at its defaults.
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows a getProcessOutput failure (process may have just ended) without throwing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount (cancelled guard)", async () => {
    let resolveProcesses!: (v: { processes: typeof PROC[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [PROC] });
      await Promise.resolve();
    });

    // Nothing to assert on result (unmounted), but this should not throw / warn.
    expect(mockApi.getActiveProcesses).toHaveBeenCalledTimes(1);
  });

  it("does not apply process output after unmount while getProcessOutput is still pending", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());

    unmount();

    await act(async () => {
      resolveOutput({ processId: "proc-1", output: "late output" });
      await Promise.resolve();
    });

    // No assertion on `result` possible post-unmount; this just verifies the
    // cancelled-guard path runs without throwing.
    expect(mockApi.getProcessOutput).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when runId changes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { rerender } = renderHook(({ runId }: { runId: string }) => useActiveProcesses(runId), {
      initialProps: { runId: "run-1" },
    });

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    rerender({ runId: "run-2" });

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-2"));
  });

  describe("SSE handling", () => {
    beforeEach(() => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    });

    it("adds a process and resets output on process:started for this run", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "pnpm build",
        stage: "execute",
        runtime: "claude",
        timestamp: "2024-02-01T00:00:00Z",
      });

      await waitFor(() => expect(result.current.processes).toHaveLength(1));
      expect(result.current.processes[0]).toEqual({
        id: "proc-2",
        pid: 0,
        command: "pnpm build",
        runId: "run-1",
        stage: "execute",
        runtime: "claude",
        startedAt: "2024-02-01T00:00:00Z",
        elapsedMs: 0,
      });
      expect(result.current.output).toBe("");
      expect(result.current.activeProcessId).toBe("proc-2");
    });

    it("fills in defaults for missing optional fields on process:started", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:started", runId: "run-1" });

      await waitFor(() => expect(result.current.processes).toHaveLength(1));
      expect(result.current.processes[0]!.id).toBe("");
      expect(result.current.processes[0]!.command).toBe("");
      expect(result.current.processes[0]!.stage).toBe("");
      expect(result.current.processes[0]!.runtime).toBe("");
      expect(typeof result.current.processes[0]!.startedAt).toBe("string");
    });

    it("ignores process:started for a different run", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:started", runId: "run-other", processId: "proc-x" });

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.processes).toEqual([]);
    });

    it("removes the process on process:completed", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
      mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "out" });

      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(result.current.hasActive).toBe(true));

      fireSSE({ type: "process:completed", runId: "run-1", processId: "proc-1" });

      await waitFor(() => expect(result.current.hasActive).toBe(false));
      expect(result.current.processes).toEqual([]);
    });

    it("appends output chunks on process:output", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:output", runId: "run-1", chunk: "hello " });
      fireSSE({ type: "process:output", runId: "run-1", chunk: "world" });

      await waitFor(() => expect(result.current.output).toBe("hello world"));
    });

    it("ignores process:output with no chunk", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:output", runId: "run-1" });

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.output).toBe("");
    });

    it("truncates output to the last 8192 characters when it grows too large", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:output", runId: "run-1", chunk: "a".repeat(5000) });
      fireSSE({ type: "process:output", runId: "run-1", chunk: "b".repeat(5000) });

      await waitFor(() => expect(result.current.output.length).toBe(8192));
      expect(result.current.output.endsWith("b".repeat(5000))).toBe(true);
    });

    it("ignores SSE events for a different run entirely", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:output", runId: "run-other", chunk: "noise" });

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.output).toBe("");
    });
  });
});
