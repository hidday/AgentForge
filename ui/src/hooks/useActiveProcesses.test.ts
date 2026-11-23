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

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};
const mockUseSSE = useSSE as unknown as ReturnType<typeof vi.fn>;

function proc(id: string): ActiveProcess {
  return {
    id,
    pid: 123,
    command: "codex",
    runId: "run-1",
    stage: "Implementing",
    runtime: "codex",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with no active processes and empty output", () => {
    mockApi.getActiveProcesses.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useActiveProcesses("run-1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("");
    expect(result.current.activeProcessId).toBeNull();
  });

  it("loads active processes and their output on mount", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.activeProcessId).toBe("p1");
    expect(result.current.output).toBe("hello");
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("does not request output when there are no active processes", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("swallows an initial fetch failure instead of throwing", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server restarting"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows a process-output failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc("p1")] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(result.current.hasActive).toBe(true));
    expect(result.current.output).toBe("");
  });

  it("does not update state from the initial fetch after unmounting before it resolves", async () => {
    let resolveFetch!: (v: { processes: ActiveProcess[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    unmount();

    await act(async () => {
      resolveFetch({ processes: [proc("p1")] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
    expect(result.current.processes).toEqual([]);
  });

  it("does not update output from getProcessOutput after unmounting before it resolves", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc("p1")] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("defaults processId and command to empty strings when the SSE event omits them", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.activeProcessId).toBe("");
    expect(result.current.processes[0]!.command).toBe("");
  });

  it("adds a process and clears output on process:started", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:started", runId: "run-1", processId: "p2", command: "cursor" });
    });

    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p2");
    expect(result.current.output).toBe("");
  });

  it("appends output chunks on process:output and truncates past 8192 chars", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:started", runId: "run-1", processId: "p2" });
    });
    act(() => {
      handler({ type: "process:output", runId: "run-1", processId: "p2", chunk: "a".repeat(5000) });
    });
    act(() => {
      handler({ type: "process:output", runId: "run-1", processId: "p2", chunk: "b".repeat(5000) });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("b")).toBe(true);
  });

  it("removes the process on process:completed", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc("p1")] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:completed", runId: "run-1", processId: "p1" });
    });

    expect(result.current.hasActive).toBe(false);
    expect(result.current.processes).toEqual([]);
  });

  it("ignores SSE events for a different run", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: DashboardEvent) => void;
    act(() => {
      handler({ type: "process:started", runId: "other-run", processId: "p9" });
    });

    expect(result.current.hasActive).toBe(false);
  });
});
