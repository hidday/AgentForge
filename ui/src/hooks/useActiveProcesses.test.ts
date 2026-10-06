import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const RUN_ID = "run-1";

function process(id: string) {
  return {
    id,
    pid: 123,
    command: "echo hi",
    runId: RUN_ID,
    stage: "Implementing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts with empty processes, hasActive false, and no output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith(RUN_ID));
  });

  it("loads active processes and fetches output for the first one", async () => {
    const proc = process("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "line1\nline2" });

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("line1\nline2"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("swallows an error from the initial getActiveProcesses call (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    // Should not throw; state stays at defaults.
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
  });

  it("swallows an error from getProcessOutput when the process has just ended", async () => {
    const proc = process("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    // Output stays empty since the output fetch failed, but no throw / crash.
    expect(result.current.output).toBe("");
  });

  it("adds a new process entry on a 'process:started' SSE event for this runId and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({
        type: "process:started",
        runId: RUN_ID,
        processId: "p2",
        command: "npm test",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2024-02-01T00:00:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "npm test",
        runId: RUN_ID,
        stage: "Implementing",
        runtime: "claude",
        startedAt: "2024-02-01T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("removes the process entry on a 'process:completed' SSE event", async () => {
    const proc = process("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      sseHandler!({ type: "process:completed", runId: RUN_ID, processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends chunk text on 'process:output' events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: RUN_ID, chunk: "hello " });
    });
    act(() => {
      sseHandler!({ type: "process:output", runId: RUN_ID, chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("truncates output to the last 8192 characters when it grows beyond that", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    act(() => {
      sseHandler!({ type: "process:output", runId: RUN_ID, chunk: bigChunk });
    });
    act(() => {
      sseHandler!({ type: "process:output", runId: RUN_ID, chunk: bigChunk });
    });

    expect(result.current.output.length).toBe(8192);
  });

  it("ignores events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({
        type: "process:started",
        runId: "other-run",
        processId: "p9",
      });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("ignores a 'process:output' event with an empty/falsy chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses(RUN_ID));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: RUN_ID, chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("cancels a pending fetch when unmounted before it resolves", async () => {
    let resolveProcesses!: (v: { processes: ReturnType<typeof process>[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses(RUN_ID));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [process("p1")] });
      await Promise.resolve();
    });

    // State was captured before unmount; verifying no crash is the primary assertion.
    expect(result.current.processes).toEqual([]);
  });
});
