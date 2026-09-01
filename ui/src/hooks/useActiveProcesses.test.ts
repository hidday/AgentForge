import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  }),
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "echo hi",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts with empty processes, hasActive false, no output, and no active id", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads processes and output for the first active process on mount", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: proc.id, output: "hello log" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith(proc.id);
    expect(result.current.output).toBe("hello log");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe(proc.id);
  });

  it("does not call getProcessOutput when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("swallows errors from getActiveProcesses and leaves state empty", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    // allow the rejected promise's catch to run
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
  });

  it("swallows errors from getProcessOutput (process may have just ended) and keeps output empty", async () => {
    const proc = makeProcess();
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.output).toBe("");
  });

  it("does not apply stale results if the runId changes before the fetch resolves", async () => {
    const resolvers: Array<(v: { processes: ActiveProcess[] }) => void> = [];
    mockApi.getActiveProcesses.mockImplementation(
      () =>
        new Promise((res) => {
          resolvers.push(res);
        }),
    );

    const { result, rerender, unmount } = renderHook(({ runId }) => useActiveProcesses(runId), {
      initialProps: { runId: "run-1" },
    });

    rerender({ runId: "run-2" });
    expect(resolvers).toHaveLength(2);

    // Resolve only the stale (run-1) fetch; the run-2 fetch is left pending.
    await act(async () => {
      resolvers[0]!({ processes: [makeProcess({ id: "stale-proc" })] });
      await Promise.resolve();
    });

    // The effect for "run-1" was cleaned up (cancelled) before its promise resolved,
    // so its result must not land in state.
    expect(result.current.processes).toEqual([]);
    unmount();
  });

  describe("SSE handling", () => {
    it("ignores events for a different runId", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:started", runId: "other-run", processId: "p9" });
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(result.current.processes).toEqual([]);
      expect(result.current.hasActive).toBe(false);
    });

    it("adds a new process entry on process:started and resets output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({
          type: "process:started",
          runId: "run-1",
          processId: "p9",
          command: "run tests",
          stage: "Implementing",
          runtime: "codex",
          timestamp: "2024-02-02T00:00:00Z",
        });
      });

      await waitFor(() => expect(result.current.processes).toHaveLength(1));
      const entry = result.current.processes[0]!;
      expect(entry.id).toBe("p9");
      expect(entry.command).toBe("run tests");
      expect(entry.runId).toBe("run-1");
      expect(entry.stage).toBe("Implementing");
      expect(entry.runtime).toBe("codex");
      expect(entry.startedAt).toBe("2024-02-02T00:00:00Z");
      expect(entry.pid).toBe(0);
      expect(entry.elapsedMs).toBe(0);
      expect(result.current.output).toBe("");
      expect(result.current.activeProcessId).toBe("p9");
    });

    it("defaults process:started fields when optional event fields are missing", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:started", runId: "run-1" });
      });

      await waitFor(() => expect(result.current.processes).toHaveLength(1));
      const entry = result.current.processes[0]!;
      expect(entry.id).toBe("");
      expect(entry.command).toBe("");
      expect(entry.stage).toBe("");
      expect(entry.runtime).toBe("");
      expect(typeof entry.startedAt).toBe("string");
    });

    it("removes the matching process on process:completed", async () => {
      const proc = makeProcess({ id: "p1" });
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
      mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(result.current.processes).toHaveLength(1));

      act(() => {
        sseHandler!({ type: "process:completed", runId: "run-1", processId: "p1" });
      });

      await waitFor(() => expect(result.current.processes).toHaveLength(0));
      expect(result.current.hasActive).toBe(false);
      expect(result.current.activeProcessId).toBeNull();
    });

    it("leaves other processes intact when process:completed targets a different id", async () => {
      const proc = makeProcess({ id: "p1" });
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
      mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(result.current.processes).toHaveLength(1));

      act(() => {
        sseHandler!({ type: "process:completed", runId: "run-1", processId: "other-id" });
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(result.current.processes).toHaveLength(1);
    });

    it("appends chunk text on process:output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: "line 1\n" });
      });
      await waitFor(() => expect(result.current.output).toBe("line 1\n"));

      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: "line 2\n" });
      });
      await waitFor(() => expect(result.current.output).toBe("line 1\nline 2\n"));
    });

    it("ignores process:output events with an empty/falsy chunk", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: "" });
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(result.current.output).toBe("");
    });

    it("truncates accumulated output to the last 8192 characters", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      const bigChunk = "a".repeat(5000);
      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });
      await waitFor(() => expect(result.current.output.length).toBe(5000));

      act(() => {
        sseHandler!({ type: "process:output", runId: "run-1", chunk: bigChunk });
      });
      await waitFor(() => expect(result.current.output.length).toBe(8192));
      expect(result.current.output.endsWith("a")).toBe(true);
    });
  });
});
