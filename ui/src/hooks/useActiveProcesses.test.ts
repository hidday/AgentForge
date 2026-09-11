import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";
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

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function latestSSEHandler(): (event: DashboardEvent) => void {
  const calls = mockUseSSE.mock.calls;
  return calls[calls.length - 1]![0] as (event: DashboardEvent) => void;
}

const process1 = {
  id: "p1",
  pid: 1234,
  command: "npm test",
  runId: "r1",
  stage: "execute",
  runtime: "node",
  startedAt: "2024-01-01T00:00:00.000Z",
  elapsedMs: 500,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with no active processes and empty output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads the process list and output for the first active process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.output).toBe("hello world"));

    expect(result.current.processes).toEqual([process1]);
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("leaves output empty when fetching process output fails (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    expect(result.current.output).toBe("");
  });

  it("leaves the process list empty when the initial fetch fails (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("connection refused"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("does not update state after unmount once the pending fetch resolves", async () => {
    let resolveFetch: (value: { processes: typeof process1[] }) => void = () => {};
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    expect(() => {
      resolveFetch({ processes: [process1] });
    }).not.toThrow();
  });

  it("does not update output after unmount once a pending output fetch resolves", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    let resolveOutput: (value: { processId: string; output: string }) => void = () => {};
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1"));

    unmount();

    expect(() => {
      resolveOutput({ processId: "p1", output: "late output" });
    }).not.toThrow();
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({ type: "process:started", runId: "other-run", processId: "px" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("adds a process and resets output on a process:started event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "npm build",
        stage: "build",
        runtime: "node",
        timestamp: "2024-02-02T00:00:00.000Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "npm build",
        runId: "r1",
        stage: "build",
        runtime: "node",
        startedAt: "2024-02-02T00:00:00.000Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("defaults missing process:started fields to empty strings and a generated timestamp", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      latestSSEHandler()({ type: "process:started", runId: "r1" });
    });

    const [entry] = result.current.processes;
    expect(entry).toMatchObject({ id: "", command: "", stage: "", runtime: "", pid: 0, elapsedMs: 0 });
    expect(typeof entry!.startedAt).toBe("string");
    expect(new Date(entry!.startedAt).toString()).not.toBe("Invalid Date");
  });

  it("removes the matching process on a process:completed event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    act(() => {
      latestSSEHandler()({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "start:" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("start:"));

    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "r1", processId: "p1", chunk: "chunk1" });
    });
    expect(result.current.output).toBe("start:chunk1");

    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "r1", processId: "p1", chunk: "chunk2" });
    });
    expect(result.current.output).toBe("start:chunk1chunk2");
  });

  it("ignores a process:output event without a chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "start:" });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("start:"));

    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "r1", processId: "p1" });
    });

    expect(result.current.output).toBe("start:");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const bigChunk = "a".repeat(5000);
    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "r1", processId: "p1", chunk: bigChunk });
    });
    act(() => {
      latestSSEHandler()({ type: "process:output", runId: "r1", processId: "p1", chunk: bigChunk });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output).toBe((bigChunk + bigChunk).slice(-8192));
  });
});
