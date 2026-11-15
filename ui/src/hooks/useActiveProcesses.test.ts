import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const PROCESS = {
  id: "proc-1",
  pid: 123,
  command: "cursor",
  runId: "run-1",
  stage: "Implementing",
  runtime: "cursor",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 100,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("starts with no active processes and empty output", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads the active process and its output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROCESS] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("proc-1");
    expect(result.current.output).toBe("hello");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("does not request output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("silently tolerates a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROCESS] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("silently tolerates a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
  });

  it("adds a process and clears output on a process:started event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "codex",
        stage: "Implementing",
        runtime: "codex",
      });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("proc-2");
    expect(result.current.output).toBe("");
  });

  it("ignores process:started events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:started", runId: "other-run", processId: "proc-2" });
    });

    expect(result.current.hasActive).toBe(false);
  });

  it("removes the process on a matching process:completed event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROCESS] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    act(() => {
      capturedHandler!({ type: "process:completed", runId: "run-1", processId: "proc-1" });
    });

    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toEqual([]);
  });

  it("appends output chunks from process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "foo" });
    });
    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "bar" });
    });

    expect(result.current.output).toBe("foobar");
  });

  it("ignores process:output events with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1" });
    });

    expect(result.current.output).toBe("");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "a".repeat(8000) });
    });
    act(() => {
      capturedHandler!({ type: "process:output", runId: "run-1", chunk: "b".repeat(500) });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
  });
});
