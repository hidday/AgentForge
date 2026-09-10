import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses";
import { api, type ActiveProcess } from "@/api/client.ts";
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

const proc: ActiveProcess = {
  id: "p1",
  pid: 123,
  command: "run tests",
  runId: "r1",
  stage: "Implementing",
  runtime: "claude-code",
  startedAt: "2026-01-01T00:00:00.000Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.mocked(api.getActiveProcesses).mockReset();
    vi.mocked(api.getProcessOutput).mockReset();
    sseHandler = null;
  });

  it("starts with no active processes when none exist", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalledWith("r1"));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");
  });

  it("loads the active process and its output on mount", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [proc] });
    vi.mocked(api.getProcessOutput).mockResolvedValue({ processId: "p1", output: "hello" });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p1");
    expect(result.current.output).toBe("hello");
  });

  it("tolerates the process output request failing because the process already ended", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [proc] });
    vi.mocked(api.getProcessOutput).mockRejectedValue(new Error("gone"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("tolerates the initial active-processes request failing", async () => {
    vi.mocked(api.getActiveProcesses).mockRejectedValue(new Error("server restarting"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
  });

  it("adds a process and resets output on process:started", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "build",
        stage: "Implementing",
        runtime: "codex",
        timestamp: "2026-01-01T01:00:00.000Z",
      });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "build",
      stage: "Implementing",
      runtime: "codex",
    });
    expect(result.current.output).toBe("");
  });

  it("defaults process:started fields when the event omits them", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalled());

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

  it("removes the process on process:completed", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [proc] });
    vi.mocked(api.getProcessOutput).mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    act(() => {
      sseHandler!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toHaveLength(0);
  });

  it("appends chunks to output on process:output", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", chunk: "line 1\n" });
    });
    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", chunk: "line 2\n" });
    });

    expect(result.current.output).toBe("line 1\nline 2\n");
  });

  it("ignores process:output events without a chunk", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1" });
    });

    expect(result.current.output).toBe("");
  });

  it("truncates buffered output to the last 8192 characters", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", chunk: "a".repeat(5000) });
    });
    act(() => {
      sseHandler!({ type: "process:output", runId: "r1", chunk: "b".repeat(5000) });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("b")).toBe(true);
    expect(result.current.output).toBe("a".repeat(3192) + "b".repeat(5000));
  });

  it("ignores SSE events for other runs", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(api.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseHandler!({ type: "process:started", runId: "other", processId: "p9" });
    });

    expect(result.current.hasActive).toBe(false);
  });

  it("discards a late process-output response after unmount", async () => {
    vi.mocked(api.getActiveProcesses).mockResolvedValue({ processes: [proc] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    vi.mocked(api.getProcessOutput).mockReturnValue(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(api.getProcessOutput).toHaveBeenCalled());

    unmount();
    resolveOutput({ processId: "p1", output: "late output" });
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.output).toBe("");
  });

  it("cancels the in-flight initial fetch on unmount", async () => {
    let resolveProcesses!: (v: { processes: ActiveProcess[] }) => void;
    vi.mocked(api.getActiveProcesses).mockReturnValue(
      new Promise((resolve) => {
        resolveProcesses = resolve;
      }),
    );
    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();
    resolveProcesses({ processes: [proc] });

    await Promise.resolve();
    await Promise.resolve();
  });
});
