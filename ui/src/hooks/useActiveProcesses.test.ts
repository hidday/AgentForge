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

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (event: DashboardEvent) => void) => {
    sseHandler = cb;
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const process1 = {
  id: "p1",
  pid: 123,
  command: "npm test",
  runId: "r1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts empty and with no active process", () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads active processes and seeds output from the first process on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    expect(result.current.output).toBe("hello world");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
  });

  it("does not call getProcessOutput when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("silently tolerates the initial getActiveProcesses call failing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("silently tolerates getProcessOutput failing (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process ended"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([process1]));
    expect(result.current.output).toBe("");
  });

  it("adds a new process and resets output on a process:started SSE event for this run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "claude",
        timestamp: "2024-02-01T00:00:00Z",
      });
    });

    expect(result.current.processes).toEqual([
      {
        id: "p2",
        pid: 0,
        command: "pnpm build",
        runId: "r1",
        stage: "Implementing",
        runtime: "claude",
        startedAt: "2024-02-01T00:00:00Z",
        elapsedMs: 0,
      },
    ]);
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
  });

  it("defaults optional process:started fields when absent", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "x" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([process1]));

    act(() => {
      sseHandler!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [process1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "start " });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("start "));

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", processId: "p1", chunk: "more" });
    });

    expect(result.current.output).toBe("start more");
  });

  it("truncates output to the last 8192 characters when it grows too large", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({
        type: "process:output",
        runId: "r1",
        processId: "p1",
        chunk: "a".repeat(5000),
      });
      sseHandler!({
        type: "process:output",
        runId: "r1",
        processId: "p1",
        chunk: "b".repeat(5000),
      });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(3192))).toBe(true);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("ignores a process:output event with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", processId: "p1" });
    });

    expect(result.current.output).toBe("");
  });

  it("cancels the init effect's state updates if the component unmounts before it resolves", async () => {
    let resolveFn: ((v: { processes: typeof process1[] }) => void) | undefined;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    expect(() => resolveFn!({ processes: [process1] })).not.toThrow();
  });
});
