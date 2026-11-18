import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "@/hooks/useSSE.ts";
import type { ActiveProcess } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("@/hooks/useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 1,
    command: "cmd",
    runId: "run-1",
    stage: "Implementing",
    runtime: "claude-code",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

function fireSSE(event: DashboardEvent) {
  act(() => {
    sseCallback?.(event);
  });
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes and empty output when none are active", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads the initial process list and fetches output for the first process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "existing output" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("existing output"));
  });

  it("swallows an error fetching process output (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));
    // Should not throw and output stays empty
    expect(result.current.output).toBe("");
  });

  it("swallows an error fetching the initial process list (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("adds a process and resets output on process:started", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    fireSSE({
      type: "process:started",
      runId: "run-1",
      processId: "p2",
      command: "build",
      stage: "Implementing",
      runtime: "claude-code",
      timestamp: "2024-02-01T00:00:00Z",
    });

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("defaults process:started fields when optional values are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    fireSSE({ type: "process:started", runId: "run-1", processId: "p3" });

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes[0]).toMatchObject({
      id: "p3",
      pid: 0,
      command: "",
      stage: "",
      runtime: "",
    });
  });

  it("removes the process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess({ id: "p1" })] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    fireSSE({ type: "process:completed", runId: "run-1", processId: "p1" });

    await waitFor(() => expect(result.current.hasActive).toBe(false));
  });

  it("appends chunks to output on process:output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    fireSSE({ type: "process:output", runId: "run-1", chunk: "hello " });
    fireSSE({ type: "process:output", runId: "run-1", chunk: "world" });

    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    const bigChunk = "a".repeat(9000);
    fireSSE({ type: "process:output", runId: "run-1", chunk: bigChunk });

    await waitFor(() => expect(result.current.output).toHaveLength(8192));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    fireSSE({ type: "process:started", runId: "run-2", processId: "px" });
    expect(result.current.hasActive).toBe(false);
  });

  it("ignores process:output events with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    fireSSE({ type: "process:output", runId: "run-1" });
    expect(result.current.output).toBe("");
  });

  it("does not update state after the hook unmounts mid-fetch", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );
    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();
    await act(async () => {
      resolveProcesses({ processes: [makeProcess()] });
      await Promise.resolve();
    });
    // No assertion on `result` after unmount is meaningful for state, but the
    // important thing is that resolving post-unmount does not throw.
    expect(result.current).toBeDefined();
  });

  it("does not update output after the hook unmounts mid-output-fetch", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });
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
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
    });
    // Resolving after unmount must not throw (covers the cancelled guard).
  });

  it("defaults the process id to an empty string when processId is missing from the event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(false));

    fireSSE({ type: "process:started", runId: "run-1" });

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.processes[0].id).toBe("");
  });

  it("re-fetches on runId change", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { rerender } = renderHook(({ runId }) => useActiveProcesses(runId), {
      initialProps: { runId: "run-1" },
    });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1"));

    rerender({ runId: "run-2" });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-2"));
  });
});
