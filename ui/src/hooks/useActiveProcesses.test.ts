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

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function makeProcess(id: string): ActiveProcess {
  return {
    id,
    pid: 123,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "codex",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

function getHandler(): (e: DashboardEvent) => void {
  return mockUseSSE.mock.calls[mockUseSSE.mock.calls.length - 1]![0] as (
    e: DashboardEvent,
  ) => void;
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with an empty, inactive state", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("fetches active processes on mount and, when one is active, fetches its output", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("run-1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(result.current.output).toBe("hello"));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("does not call getProcessOutput when there is no active process", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("tolerates a rejected getActiveProcesses call without throwing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    // Give the rejected promise a tick to settle inside the hook's try/catch.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("tolerates a rejected getProcessOutput call without throwing", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc]));
    // Give the rejected getProcessOutput promise a tick to settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.output).toBe("");
  });

  it("adds a process on process:started and clears output for the matching runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getHandler();

    act(() =>
      handler({
        type: "process:started",
        runId: "run-1",
        processId: "p2",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "codex",
        timestamp: "2024-01-01T00:00:05Z",
      }),
    );

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "pnpm build",
      runId: "run-1",
      stage: "Implementing",
      runtime: "codex",
      startedAt: "2024-01-01T00:00:05Z",
    });
    expect(result.current.hasActive).toBe(true);
    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getHandler();
    act(() => handler({ type: "process:started", runId: "other-run", processId: "px" }));

    // Give any accidental async updates a chance to happen.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on process:completed", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc]));

    const handler = getHandler();
    act(() => handler({ type: "process:completed", runId: "run-1", processId: "p1" }));

    await waitFor(() => expect(result.current.processes).toEqual([]));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("accumulates output chunks from process:output events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getHandler();
    act(() => handler({ type: "process:output", runId: "run-1", chunk: "hello " }));
    act(() => handler({ type: "process:output", runId: "run-1", chunk: "world" }));

    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getHandler();
    const firstChunk = "start-marker"; // 12 chars, should be pushed out entirely
    const secondChunk = "b".repeat(9000); // alone exceeds the 8192 cap

    act(() => handler({ type: "process:output", runId: "run-1", chunk: firstChunk }));
    act(() => handler({ type: "process:output", runId: "run-1", chunk: secondChunk }));

    await waitFor(() => expect(result.current.output.length).toBe(8192));
    // The tail (most recent 8192 chars) is preserved; since the second chunk
    // alone is longer than the cap, the first chunk is pushed out entirely.
    expect(result.current.output).toBe("b".repeat(8192));
  });

  it("ignores process:output events with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = getHandler();
    act(() => handler({ type: "process:output", runId: "run-1" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.output).toBe("");
  });
});
