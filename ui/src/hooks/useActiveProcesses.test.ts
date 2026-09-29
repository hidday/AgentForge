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

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: DashboardEvent) => void) => {
    sseCallback = cb;
  }),
}));

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "p1",
    pid: 123,
    command: "npm test",
    runId: "r1",
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
    sseCallback = null;
  });

  it("starts with empty processes, no active process, and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("resolves with processes and fetches output for the first active process", async () => {
    const proc = makeProcess({ id: "p1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello output" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello output"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("does not call getProcessOutput when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(false));
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("swallows errors from getActiveProcesses (server restarting) and stays empty", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows errors from getProcessOutput (process may have just ended)", async () => {
    const proc = makeProcess({ id: "p1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    // Output stays empty since the output fetch failed, but no crash.
    expect(result.current.output).toBe("");
  });

  it("adds a process on a process:started SSE event for this run and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "pytest",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2024-01-01T00:01:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "pytest",
        runId: "r1",
        stage: "Implementing",
        runtime: "claude",
        startedAt: "2024-01-01T00:01:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
  });

  it("ignores process:started events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "other-run", processId: "p2" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on a process:completed SSE event", async () => {
    const proc = makeProcess({ id: "p1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    act(() => {
      sseCallback!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends output chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "line1\n" });
    });
    expect(result.current.output).toBe("line1\n");

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "line2\n" });
    });
    expect(result.current.output).toBe("line1\nline2\n");
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: bigChunk });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: bigChunk });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output).toBe("a".repeat(8192));
  });

  it("uses fallback values when process:started event fields are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    const proc = result.current.processes[0]!;
    expect(proc.id).toBe("");
    expect(proc.command).toBe("");
    expect(proc.stage).toBe("");
    expect(proc.runtime).toBe("");
    expect(typeof proc.startedAt).toBe("string");
    expect(proc.startedAt.length).toBeGreaterThan(0);
  });

  it("does not update state after unmount once the initial fetch resolves", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    // Resolve after unmount — the cancelled guard should prevent a state update crash.
    expect(() => {
      resolveProcesses({ processes: [makeProcess()] });
    }).not.toThrow();
  });

  it("does not update output after unmount once getProcessOutput resolves", async () => {
    const proc = makeProcess({ id: "p1" });
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    unmount();

    expect(() => {
      resolveOutput({ processId: "p1", output: "late output" });
    }).not.toThrow();
  });

  it("ignores process:output events with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1" });
    });
    expect(result.current.output).toBe("");
  });
});
