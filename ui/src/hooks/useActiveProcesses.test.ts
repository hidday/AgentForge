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

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const RUN_ID = "run-1";
const proc1 = {
  id: "proc-1",
  pid: 123,
  command: "pnpm test",
  runId: RUN_ID,
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 10,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with empty processes, no output and no active process", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads processes and fetches output for the first active process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc1.id, output: "log line" });

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(result.current.processes).toEqual([proc1]));

    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith(RUN_ID);
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc1.id);
    expect(result.current.output).toBe("log line");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc1.id);
  });

  it("does not fetch output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("swallows a getActiveProcesses rejection and leaves processes empty", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("swallows a getProcessOutput rejection (process may have just ended) but keeps processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(result.current.processes).toEqual([proc1]));
    expect(result.current.output).toBe("");
  });

  it("does not update state after unmount (cancellation guard)", async () => {
    let resolveFn!: (v: { processes: typeof proc1[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses(RUN_ID));
    unmount();

    // Resolving after unmount must not throw or produce unhandled updates.
    await act(async () => {
      resolveFn({ processes: [proc1] });
      await Promise.resolve();
    });
  });

  describe("SSE handling", () => {
    it("ignores events for a different run", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses(RUN_ID));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:started", runId: "other-run", processId: "x" });

      expect(result.current.processes).toEqual([]);
    });

    it("adds a process entry on process:started and resets output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses(RUN_ID));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({
        type: "process:started",
        runId: RUN_ID,
        processId: "proc-2",
        command: "npm run build",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2024-02-02T00:00:00Z",
      });

      expect(result.current.processes).toHaveLength(1);
      expect(result.current.processes[0]).toMatchObject({
        id: "proc-2",
        command: "npm run build",
        stage: "Implementing",
        runtime: "claude",
        runId: RUN_ID,
        startedAt: "2024-02-02T00:00:00Z",
        elapsedMs: 0,
      });
      expect(result.current.output).toBe("");
      expect(result.current.activeProcessId).toBe("proc-2");
    });

    it("removes the matching process on process:completed", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
      mockApi.getProcessOutput.mockResolvedValue({ processId: proc1.id, output: "x" });
      const { result } = renderHook(() => useActiveProcesses(RUN_ID));
      await waitFor(() => expect(result.current.processes).toEqual([proc1]));

      fireSSE({ type: "process:completed", runId: RUN_ID, processId: proc1.id });

      expect(result.current.processes).toEqual([]);
      expect(result.current.hasActive).toBe(false);
    });

    it("appends output chunks on process:output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses(RUN_ID));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:output", runId: RUN_ID, chunk: "hello " });
      fireSSE({ type: "process:output", runId: RUN_ID, chunk: "world" });

      expect(result.current.output).toBe("hello world");
    });

    it("truncates output to the last 8192 characters", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses(RUN_ID));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      const bigChunk = "a".repeat(8000);
      fireSSE({ type: "process:output", runId: RUN_ID, chunk: bigChunk });
      fireSSE({ type: "process:output", runId: RUN_ID, chunk: "b".repeat(300) });

      expect(result.current.output.length).toBe(8192);
      expect(result.current.output.endsWith("b".repeat(300))).toBe(true);
    });

    it("ignores process:output events with an empty/falsy chunk", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses(RUN_ID));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      fireSSE({ type: "process:output", runId: RUN_ID, chunk: "" });

      expect(result.current.output).toBe("");
    });
  });
});
