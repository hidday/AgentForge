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
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(id: string) {
  return {
    id,
    pid: 123,
    command: "npm test",
    runId: "r1",
    stage: "executor",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 100,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with empty processes, hasActive false, and no output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
  });

  it("fetches process output for the first active process and populates state", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello log" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes).toEqual([makeProcess("p1")]);
    expect(result.current.activeProcessId).toBe("p1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(result.current.output).toBe("hello log"));
  });

  it("swallows a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("swallows a getActiveProcesses failure and leaves defaults intact", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not update state after unmount (cancelled guard)", async () => {
    let resolveProcesses!: (v: { processes: unknown[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [makeProcess("p1")] });
      await Promise.resolve();
    });

    // State captured before unmount remains unchanged - no post-unmount update occurred.
    expect(result.current.processes).toEqual([]);
  });

  describe("SSE handling", () => {
    it("adds a new process entry and resets output on process:started for this run", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("r1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({
          type: "process:started",
          runId: "r1",
          processId: "p2",
          command: "pnpm build",
          stage: "planner",
          runtime: "codex",
          timestamp: "2024-02-01T00:00:00Z",
        });
      });

      expect(result.current.processes).toEqual([
        {
          id: "p2",
          pid: 0,
          command: "pnpm build",
          runId: "r1",
          stage: "planner",
          runtime: "codex",
          startedAt: "2024-02-01T00:00:00Z",
          elapsedMs: 0,
        },
      ]);
      expect(result.current.output).toBe("");
    });

    it("ignores process:started events for a different run id", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("r1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({ type: "process:started", runId: "other", processId: "p2" });
      });

      expect(result.current.processes).toEqual([]);
    });

    it("removes the process on process:completed", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess("p1")] });
      mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
      const { result } = renderHook(() => useActiveProcesses("r1"));
      await waitFor(() => expect(result.current.processes).toHaveLength(1));

      act(() => {
        sseCallback!({ type: "process:completed", runId: "r1", processId: "p1" });
      });

      expect(result.current.processes).toEqual([]);
    });

    it("appends chunks to output on process:output", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("r1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({ type: "process:output", runId: "r1", chunk: "line 1\n" });
      });
      expect(result.current.output).toBe("line 1\n");

      act(() => {
        sseCallback!({ type: "process:output", runId: "r1", chunk: "line 2\n" });
      });
      expect(result.current.output).toBe("line 1\nline 2\n");
    });

    it("truncates output to the last 8192 characters", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("r1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      const big = "a".repeat(8000);
      act(() => {
        sseCallback!({ type: "process:output", runId: "r1", chunk: big });
      });
      act(() => {
        sseCallback!({ type: "process:output", runId: "r1", chunk: "b".repeat(500) });
      });

      expect(result.current.output.length).toBe(8192);
      expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
    });

    it("ignores process:output events without a chunk", async () => {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const { result } = renderHook(() => useActiveProcesses("r1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

      act(() => {
        sseCallback!({ type: "process:output", runId: "r1" });
      });
      expect(result.current.output).toBe("");
    });
  });
});
