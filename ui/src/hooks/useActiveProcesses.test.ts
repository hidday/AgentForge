import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseCallback: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", async () => {
  const actual = await vi.importActual<typeof import("./useSSE.ts")>("./useSSE.ts");
  return {
    ...actual,
    useSSE: (cb: (event: DashboardEvent) => void) => {
      sseCallback = cb;
    },
  };
});

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const proc1 = {
  id: "proc-1",
  pid: 123,
  command: "npm test",
  runId: "run-1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 1000,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and fetches output for the first one", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "hello output" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("proc-1");
    expect(result.current.output).toBe("hello output");
    expect(result.current.activeProcessId).toBe("proc-1");
  });

  it("leaves output empty when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.hasActive).toBe(false);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("swallows a getActiveProcesses failure (e.g. server restarting) without throwing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("swallows a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("applies fallback defaults for missing optional fields on process:started", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback!({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("does not update output state when unmounted between the initial fetch and the output fetch resolving", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());

    unmount();

    // Resolving after unmount should not throw or trigger a state update.
    await act(async () => {
      resolveOutput({ processId: "proc-1", output: "late output" });
    });
  });

  it("does not update state after unmount (cancelled guard)", async () => {
    let resolveProcesses!: (v: { processes: typeof proc1[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    // Resolve after unmount — should not throw or cause act() warnings.
    await act(async () => {
      resolveProcesses({ processes: [proc1] });
    });
  });

  it("appends a new process and resets output on process:started SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback!({
        type: "process:started",
        runId: "run-1",
        processId: "proc-2",
        command: "pytest",
        stage: "Implementing",
        runtime: "claude",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]!.id).toBe("proc-2");
    expect(result.current.processes[0]!.command).toBe("pytest");
    expect(result.current.output).toBe("");
    expect(result.current.hasActive).toBe(true);
  });

  it("removes the process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "proc-1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    await act(async () => {
      sseCallback!({ type: "process:completed", runId: "run-1", processId: "proc-1" });
    });

    expect(result.current.processes).toHaveLength(0);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends chunk text to output on process:output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback!({ type: "process:output", runId: "run-1", chunk: "line 1\n" });
    });
    await act(async () => {
      sseCallback!({ type: "process:output", runId: "run-1", chunk: "line 2\n" });
    });

    expect(result.current.output).toBe("line 1\nline 2\n");
  });

  it("truncates output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const big = "x".repeat(9000);
    await act(async () => {
      sseCallback!({ type: "process:output", runId: "run-1", chunk: big });
    });

    expect(result.current.output).toHaveLength(8192);
  });

  it("ignores process:output events with no chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback!({ type: "process:output", runId: "run-1" });
    });

    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    await act(async () => {
      sseCallback!({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.processes).toEqual([]);
  });
});
