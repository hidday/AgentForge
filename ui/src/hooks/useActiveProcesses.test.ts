import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseHandler: ((event: unknown) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: unknown) => void) => {
    sseHandler = cb;
  }),
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const PROC = {
  id: "proc-1",
  pid: 123,
  command: "npm test",
  runId: "run-1",
  stage: "executing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 10,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("initially reports no active processes and empty output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads existing processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
    expect(result.current.processes).toEqual([PROC]);
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(result.current.output).toBe("hello world");
  });

  it("swallows a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
    expect(result.current.processes).toEqual([PROC]);
  });

  it("does not update state after unmount (cancelled guard)", async () => {
    let resolveProcesses!: (v: { processes: typeof PROC[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [PROC] });
      await Promise.resolve();
    });

    // State should remain at initial default since the component unmounted before resolution.
    expect(result.current.processes).toEqual([]);
  });

  it("does not apply output once unmounted while getProcessOutput is still pending", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
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
      resolveOutput({ processId: "proc-1", output: "late output" });
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  describe("SSE handling", () => {
    it("ignores events for a different runId", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:started", runId: "other-run", processId: "proc-x" });
      });

      expect(result.current.processes).toEqual([]);
    });

    it("process:started adds a new process entry and resets output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({
          type: "process:started",
          runId: "run-1",
          processId: "proc-2",
          command: "pnpm build",
          stage: "building",
          runtime: "claude",
          timestamp: "2024-02-01T00:00:00Z",
        });
      });

      expect(result.current.processes).toEqual([
        {
          id: "proc-2",
          pid: 0,
          command: "pnpm build",
          runId: "run-1",
          stage: "building",
          runtime: "claude",
          startedAt: "2024-02-01T00:00:00Z",
          elapsedMs: 0,
        },
      ]);
      expect(result.current.output).toBe("");
      expect(result.current.hasActive).toBe(true);
      expect(result.current.activeProcessId).toBe("proc-2");
    });

    it("process:started fills in defaults when optional fields are absent", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:started", runId: "run-1" });
      });

      const proc = result.current.processes[0];
      expect(proc.id).toBe("");
      expect(proc.command).toBe("");
      expect(proc.stage).toBe("");
      expect(proc.runtime).toBe("");
      expect(typeof proc.startedAt).toBe("string");
    });

    it("process:completed removes the matching process", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
      mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(result.current.hasActive).toBe(true));

      act(() => {
        sseHandler!({ type: "process:completed", runId: "run-1", processId: "proc-1" });
      });

      expect(result.current.processes).toEqual([]);
      expect(result.current.hasActive).toBe(false);
      expect(result.current.activeProcessId).toBeNull();
    });

    it("process:output appends chunk to the running output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: "line 1\n" });
      });
      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: "line 2\n" });
      });

      expect(result.current.output).toBe("line 1\nline 2\n");
    });

    it("process:output with no chunk does not change output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1" });
      });

      expect(result.current.output).toBe("");
    });

    it("truncates output to the last 8192 characters when it grows beyond that", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      const bigChunk = "a".repeat(5000);
      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });
      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });

      expect(result.current.output.length).toBe(8192);
      expect(result.current.output).toBe("a".repeat(8192));
    });
  });
});
