import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import { useActiveProcesses } from "./useActiveProcesses.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const proc1 = {
  id: "p1",
  pid: 100,
  command: "pnpm test",
  runId: "r1",
  stage: "Implementing",
  runtime: "claude-code",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 0,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes and hasActive false when none are running", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads the first active process and its output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "building..." });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p1");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(result.current.output).toBe("building..."));
  });

  it("swallows a failed output fetch (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("swallows a failed getActiveProcesses call (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("ECONNREFUSED"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("adds a process and resets output on 'process:started'", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "npm run build",
        stage: "Implementing",
        runtime: "codex",
      });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "npm run build",
      stage: "Implementing",
      runtime: "codex",
    });
    expect(result.current.output).toBe("");
  });

  it("removes the matching process on 'process:completed'", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    act(() => {
      sseCallback!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toEqual([]);
  });

  it("appends output chunks on 'process:output'", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "hello " });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "world" });
    });

    expect(result.current.output).toBe("hello world");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
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
    expect(result.current.output.endsWith("a")).toBe(true);
  });

  it("ignores events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.hasActive).toBe(false);
  });

  it("ignores a 'process:output' event with an empty chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("does not apply a pending output fetch result after unmount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
    });

    expect(result.current.output).toBe("");
  });

  it("fills in default values for a 'process:started' event missing optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.processes[0]).toMatchObject({
      id: "",
      command: "",
      stage: "",
      runtime: "",
    });
    expect(typeof result.current.processes[0]!.startedAt).toBe("string");
  });

  it("does not apply the init fetch result after unmount", async () => {
    let resolveProcesses!: (v: { processes: typeof proc1[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [proc1] });
    });

    // No assertion crash means the cancelled-guard prevented a post-unmount
    // state update; React would otherwise warn/throw in strict test setups.
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });
});
