import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

const PROC = {
  id: "p1",
  pid: 123,
  command: "do-the-thing",
  runId: "run-1",
  stage: "execute",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 10,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with empty processes, no active process and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes on mount and leaves output empty when there are none", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("fetches output for the first active process and exposes it", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "line one" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.output).toBe("line one"));

    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    expect(result.current.processes).toEqual([PROC]);
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("keeps processes set but leaves output empty when fetching output fails", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([PROC]));

    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("silently tolerates the initial processes fetch failing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not update state after unmount while the initial fetch is still pending", async () => {
    let resolveProcesses!: (v: { processes: typeof PROC[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolving after unmount must not throw or trigger a React warning.
    expect(() => {
      act(() => resolveProcesses({ processes: [PROC] }));
    }).not.toThrow();
  });

  it("does not apply a late process-output response after unmount", async () => {
    let resolveProcesses!: (v: { processes: typeof PROC[] }) => void;
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));

    await act(async () => {
      resolveProcesses({ processes: [PROC] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");

    unmount();

    // Resolving after unmount must not throw, and must not apply the late output.
    await expect(
      act(async () => {
        resolveOutput({ processId: "p1", output: "too-late" });
        await Promise.resolve();
      }),
    ).resolves.not.toThrow();
  });

  describe("SSE handling", () => {
    async function setup() {
      mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
      const rendered = renderHook(() => useActiveProcesses("run-1"));
      await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
      return rendered;
    }

    it("ignores events for a different runId", async () => {
      const { result } = await setup();

      act(() => {
        latestHandler()({ type: "process:started", runId: "other-run", processId: "p9" });
      });

      expect(result.current.processes).toEqual([]);
    });

    it("adds a process entry and resets output on process:started", async () => {
      const { result } = await setup();

      act(() => {
        latestHandler()({
          type: "process:started",
          runId: "run-1",
          processId: "p2",
          command: "build",
          stage: "plan",
          runtime: "codex",
          timestamp: "2024-02-02T00:00:00Z",
        });
      });

      expect(result.current.processes).toEqual([
        {
          id: "p2",
          pid: 0,
          command: "build",
          runId: "run-1",
          stage: "plan",
          runtime: "codex",
          startedAt: "2024-02-02T00:00:00Z",
          elapsedMs: 0,
        },
      ]);
      expect(result.current.output).toBe("");
      expect(result.current.activeProcessId).toBe("p2");
    });

    it("fills in defaults when optional process:started fields are missing", async () => {
      const { result } = await setup();

      act(() => {
        latestHandler()({ type: "process:started", runId: "run-1" });
      });

      const proc = result.current.processes[0]!;
      expect(proc.id).toBe("");
      expect(proc.command).toBe("");
      expect(proc.stage).toBe("");
      expect(proc.runtime).toBe("");
      expect(typeof proc.startedAt).toBe("string");
    });

    it("removes the matching process on process:completed", async () => {
      const { result } = await setup();

      act(() => {
        latestHandler()({ type: "process:started", runId: "run-1", processId: "p3" });
      });
      expect(result.current.processes).toHaveLength(1);

      act(() => {
        latestHandler()({ type: "process:completed", runId: "run-1", processId: "p3" });
      });

      expect(result.current.processes).toHaveLength(0);
      expect(result.current.hasActive).toBe(false);
      expect(result.current.activeProcessId).toBeNull();
    });

    it("appends output chunks on process:output", async () => {
      const { result } = await setup();

      act(() => {
        latestHandler()({ type: "process:output", runId: "run-1", chunk: "hello " });
      });
      act(() => {
        latestHandler()({ type: "process:output", runId: "run-1", chunk: "world" });
      });

      expect(result.current.output).toBe("hello world");
    });

    it("ignores process:output events with no chunk", async () => {
      const { result } = await setup();

      act(() => {
        latestHandler()({ type: "process:output", runId: "run-1" });
      });

      expect(result.current.output).toBe("");
    });

    it("truncates accumulated output to the last 8192 characters", async () => {
      const { result } = await setup();

      act(() => {
        latestHandler()({ type: "process:output", runId: "run-1", chunk: "a".repeat(5000) });
      });
      act(() => {
        latestHandler()({ type: "process:output", runId: "run-1", chunk: "b".repeat(5000) });
      });

      expect(result.current.output.length).toBe(8192);
      expect(result.current.output.endsWith("b".repeat(5000))).toBe(true);
      expect(result.current.output.startsWith("a")).toBe(true);
    });
  });
});
