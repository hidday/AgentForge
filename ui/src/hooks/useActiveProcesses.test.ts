import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseHandler: ((event: unknown) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: unknown) => void) => {
    sseHandler = cb;
  }),
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const proc1 = {
  id: "p1",
  pid: 123,
  command: "run-plan",
  runId: "r1",
  stage: "planning",
  runtime: "claude",
  startedAt: "2026-01-01T00:00:00.000Z",
  elapsedMs: 500,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("starts with empty processes, no active process, and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and fetches output for the first one", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc1]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello"));
    expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("does not fetch process output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("swallows a getActiveProcesses failure and keeps default state", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
  });

  it("swallows a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("process gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([proc1]));
    expect(result.current.output).toBe("");
  });

  it("ignores the init fetch result if the effect is cleaned up before it resolves", async () => {
    let resolveFn: (value: { processes: typeof proc1[] }) => void = () => {};
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveFn({ processes: [proc1] });
      await Promise.resolve();
    });

    expect(result.current.processes).toEqual([]);
  });

  it("ignores a getProcessOutput result that resolves after the effect is cleaned up", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    let resolveOutput: (value: { processId: string; output: string }) => void = () => {};
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    // Let the first await (getActiveProcesses) resolve and the nested
    // getProcessOutput call be issued, then unmount before it settles.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("adds a process on a process:started SSE event for the same run and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "run-exec",
        stage: "executing",
        runtime: "claude",
        timestamp: "2026-02-01T00:00:00.000Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      pid: 0,
      command: "run-exec",
      runId: "r1",
      stage: "executing",
      runtime: "claude",
      startedAt: "2026-02-01T00:00:00.000Z",
      elapsedMs: 0,
    });
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("defaults process:started fields and timestamp when missing from the event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:started", runId: "r1", processId: "p3" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "p3",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("defaults process id to an empty string when processId is entirely absent", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:started", runId: "r1" });
    });

    expect(result.current.processes[0]!.id).toBe("");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc1]));

    act(() => {
      sseHandler?.({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends output chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:output", runId: "r1", chunk: "foo" });
    });
    act(() => {
      sseHandler?.({ type: "process:output", runId: "r1", chunk: "bar" });
    });

    expect(result.current.output).toBe("foobar");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const big = "a".repeat(8000);
    act(() => {
      sseHandler?.({ type: "process:output", runId: "r1", chunk: big });
    });
    act(() => {
      sseHandler?.({ type: "process:output", runId: "r1", chunk: "b".repeat(500) });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b".repeat(500))).toBe(true);
  });

  it("ignores a process:output event with an empty/falsy chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler?.({ type: "process:output", runId: "r1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("re-runs the init effect when runId changes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { rerender } = renderHook(({ runId }) => useActiveProcesses(runId), {
      initialProps: { runId: "r1" },
    });
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));

    rerender({ runId: "r2" });

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r2"));
  });
});
