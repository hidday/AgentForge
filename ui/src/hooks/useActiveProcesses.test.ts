import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses";
import type { DashboardEvent } from "./useSSE";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const proc = {
  id: "proc-1",
  pid: 123,
  command: "npm test",
  runId: "run-1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2026-01-01T00:00:00Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
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

  it("loads the active process and its output on init", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-1");
    await waitFor(() => expect(result.current.output).toBe("hello"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("swallows an error fetching active processes (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("swallows an error fetching process output (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    // output stays empty since the output fetch failed silently
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount (cancelled init)", async () => {
    let resolveProcesses: (value: { processes: typeof proc[] }) => void = () => {};
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveProcesses = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();
    resolveProcesses({ processes: [proc] });

    // Give the microtask queue a chance to run; state must not have updated.
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.processes).toEqual([]);
  });

  describe("SSE handling", () => {
    beforeEach(() => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    });

    it("ignores events for a different runId", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({
          type: "process:started",
          runId: "other-run",
          processId: "proc-x",
        });
      });

      expect(result.current.processes).toEqual([]);
    });

    it("adds a process and resets output on process:started", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({
          type: "process:started",
          runId: "run-1",
          processId: "proc-2",
          command: "pnpm build",
          stage: "Implementing",
          runtime: "claude",
          timestamp: "2026-02-02T00:00:00Z",
        });
      });

      expect(result.current.processes).toHaveLength(1);
      expect(result.current.processes[0]).toMatchObject({
        id: "proc-2",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "claude",
        runId: "run-1",
        startedAt: "2026-02-02T00:00:00Z",
      });
      expect(result.current.output).toBe("");
    });

    it("defaults process:started fields and timestamp when absent", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({ type: "process:started", runId: "run-1" });
      });

      const added = result.current.processes[0]!;
      expect(added.id).toBe("");
      expect(added.command).toBe("");
      expect(added.stage).toBe("");
      expect(added.runtime).toBe("");
      expect(typeof added.startedAt).toBe("string");
    });

    it("removes a process on process:completed", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({ type: "process:started", runId: "run-1", processId: "proc-2" });
      });
      expect(result.current.processes).toHaveLength(1);

      act(() => {
        sseCallback!({ type: "process:completed", runId: "run-1", processId: "proc-2" });
      });
      expect(result.current.processes).toEqual([]);
      expect(result.current.hasActive).toBe(false);
    });

    it("appends chunks to output on process:output", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({ type: "process:output", runId: "run-1", chunk: "line1\n" });
      });
      expect(result.current.output).toBe("line1\n");

      act(() => {
        sseCallback!({ type: "process:output", runId: "run-1", chunk: "line2\n" });
      });
      expect(result.current.output).toBe("line1\nline2\n");
    });

    it("ignores process:output events with an empty chunk", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({ type: "process:output", runId: "run-1", chunk: "" });
      });
      expect(result.current.output).toBe("");
    });

    it("truncates accumulated output to the last 8192 characters", async () => {
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      const bigChunk = "a".repeat(5000);
      act(() => {
        sseCallback!({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });
      act(() => {
        sseCallback!({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });

      expect(result.current.output.length).toBe(8192);
      expect(result.current.output).toBe("a".repeat(8192));
    });
  });
});
