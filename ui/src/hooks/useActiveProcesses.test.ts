import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";
import type { DashboardEvent } from "@/hooks/useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;

vi.mock("@/hooks/useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSSE.ts")>("@/hooks/useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const proc1 = {
  id: "p1",
  pid: 123,
  command: "run-tests",
  runId: "r1",
  stage: "executing",
  runtime: "codex",
  startedAt: "2026-01-01T00:00:00Z",
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

  it("starts with no processes and hasActive false", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and fetches output for the first process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc1]));

    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("does not fetch process output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("silently ignores a failure to load active processes", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    // Give the rejected promise's catch handler a tick to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
  });

  it("silently ignores a failure to load process output (process may have ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc1]));
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.output).toBe("");
  });

  it("adds a process on a process:started SSE event and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({
      type: "process:started",
      runId: "r1",
      processId: "p2",
      command: "build",
      stage: "planning",
      runtime: "claude",
      timestamp: "2026-02-02T00:00:00Z",
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "build",
        runId: "r1",
        stage: "planning",
        runtime: "claude",
        startedAt: "2026-02-02T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:started", runId: "other-run", processId: "p9" });

    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc1]));

    fireSSE({ type: "process:completed", runId: "r1", processId: "p1" });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "start:" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("start:"));

    fireSSE({ type: "process:output", runId: "r1", processId: "p1", chunk: "chunk1" });

    expect(result.current.output).toBe("start:chunk1");

    fireSSE({ type: "process:output", runId: "r1", processId: "p1", chunk: "chunk2" });

    expect(result.current.output).toBe("start:chunk1chunk2");
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(9000);
    fireSSE({ type: "process:output", runId: "r1", processId: "p1", chunk: bigChunk });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output).toBe("a".repeat(8192));
  });

  it("ignores process:output events with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    fireSSE({ type: "process:output", runId: "r1", processId: "p1", chunk: "" });

    expect(result.current.output).toBe("");
  });
});
