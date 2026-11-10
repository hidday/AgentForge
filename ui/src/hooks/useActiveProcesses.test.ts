import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import { useActiveProcesses } from "./useActiveProcesses";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const PROC = {
  id: "proc-1",
  pid: 123,
  command: "echo hi",
  runId: "run-1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00.000Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with empty processes, no active process and empty output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));
    expect(result.current.output).toBe("");
  });

  it("fetches process output for the first active process on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: PROC.id, output: "hello output" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.output).toBe("hello output"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(PROC.id);
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(PROC.id);
    expect(result.current.processes).toEqual([PROC]);
  });

  it("keeps processes set even if fetching output fails (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([PROC]));
    expect(result.current.output).toBe("");
  });

  it("silently tolerates getActiveProcesses failing (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("does not update state after unmount (cancellation guard)", async () => {
    const d = deferred<{ processes: (typeof PROC)[] }>();
    mockApi.getActiveProcesses.mockReturnValue(d.promise);

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolve after unmount; the cancelled flag should prevent any state update,
    // and in particular must not throw / reject unhandled.
    await act(async () => {
      d.resolve({ processes: [PROC] });
      await Promise.resolve();
    });
    // No assertion target on unmounted result; success is "nothing threw".
  });

  it("does not update output after unmount even if getProcessOutput resolves late (cancellation guard)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    const outputDeferred = deferred<{ processId: string; output: string }>();
    mockApi.getProcessOutput.mockReturnValue(outputDeferred.promise);

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith(PROC.id));

    unmount();

    await act(async () => {
      outputDeferred.resolve({ processId: PROC.id, output: "too late" });
      await Promise.resolve();
    });
    // Success is "nothing threw" and no error is logged for a post-unmount state update.
  });

  it("re-runs the init fetch when runId changes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { rerender } = renderHook(({ id }: { id: string }) => useActiveProcesses(id), {
      initialProps: { id: "run-1" },
    });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    rerender({ id: "run-2" });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-2"));
  });

  describe("SSE handling", () => {
    async function setup() {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
      const handler = mockUseSSE.mock.calls[0][0] as (event: DashboardEvent) => void;
      return { result, handler };
    }

    it("ignores events for a different runId", async () => {
      const { result, handler } = await setup();
      act(() => {
        handler({ type: "process:started", runId: "other-run", processId: "p9" });
      });
      expect(result.current.processes).toEqual([]);
    });

    it("adds a process entry and resets output on 'process:started'", async () => {
      const { result, handler } = await setup();
      act(() => {
        handler({
          type: "process:started",
          runId: "run-1",
          processId: "p9",
          command: "npm test",
          stage: "Implementing",
          runtime: "claude",
          timestamp: "2024-02-01T00:00:00.000Z",
        });
      });
      expect(result.current.processes).toEqual([
        {
          id: "p9",
          pid: 0,
          command: "npm test",
          runId: "run-1",
          stage: "Implementing",
          runtime: "claude",
          startedAt: "2024-02-01T00:00:00.000Z",
          elapsedMs: 0,
        },
      ]);
      expect(result.current.output).toBe("");
      expect(result.current.hasActive).toBe(true);
      expect(result.current.activeProcessId).toBe("p9");
    });

    it("fills in defaults for a 'process:started' event missing optional fields", async () => {
      const { result, handler } = await setup();
      act(() => {
        handler({ type: "process:started", runId: "run-1" });
      });
      const proc = result.current.processes[0];
      expect(proc.id).toBe("");
      expect(proc.command).toBe("");
      expect(proc.stage).toBe("");
      expect(proc.runtime).toBe("");
      expect(typeof proc.startedAt).toBe("string");
    });

    it("removes the matching process on 'process:completed'", async () => {
      const { result, handler } = await setup();
      act(() => {
        handler({ type: "process:started", runId: "run-1", processId: "p1" });
      });
      act(() => {
        handler({ type: "process:started", runId: "run-1", processId: "p2" });
      });
      expect(result.current.processes).toHaveLength(2);

      act(() => {
        handler({ type: "process:completed", runId: "run-1", processId: "p1" });
      });
      expect(result.current.processes.map((p) => p.id)).toEqual(["p2"]);
    });

    it("appends chunk text to output on 'process:output'", async () => {
      const { result, handler } = await setup();
      act(() => {
        handler({ type: "process:output", runId: "run-1", chunk: "hello " });
      });
      act(() => {
        handler({ type: "process:output", runId: "run-1", chunk: "world" });
      });
      expect(result.current.output).toBe("hello world");
    });

    it("ignores 'process:output' events with an empty/missing chunk", async () => {
      const { result, handler } = await setup();
      act(() => {
        handler({ type: "process:output", runId: "run-1", chunk: "" });
      });
      expect(result.current.output).toBe("");
    });

    it("truncates accumulated output to the last 8192 characters", async () => {
      const { result, handler } = await setup();
      const bigChunk = "a".repeat(5000);
      act(() => {
        handler({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });
      act(() => {
        handler({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });
      expect(result.current.output.length).toBe(8192);
      expect(result.current.output).toBe(("a".repeat(5000) + "a".repeat(5000)).slice(-8192));
    });
  });
});
