import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ActiveProcess } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn(),
}));

import { useActiveProcesses } from "./useActiveProcesses";
import { api } from "@/api/client.ts";
import { useSSE } from "./useSSE.ts";

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
    runId: "r1",
    stage: "executing",
    runtime: "claude",
    startedAt: "2026-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with no active processes and empty output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
  });

  it("loads existing processes and fetches output for the first one", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello world" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello world"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("swallows an error fetching the process list (server restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("server down"));
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("swallows an error fetching process output (process may have just ended)", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toHaveLength(1));
    // Output stays empty since the output fetch failed, but no throw / crash.
    expect(result.current.output).toBe("");
  });

  it("adds a new process and clears output on a 'process:started' SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: Record<string, unknown>) => void;
    act(() => {
      handler({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "pnpm build",
        stage: "executing",
        runtime: "claude",
        timestamp: "2026-02-01T00:00:00Z",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "pnpm build",
      runId: "r1",
      stage: "executing",
      runtime: "claude",
      startedAt: "2026-02-01T00:00:00Z",
    });
    expect(result.current.output).toBe("");
  });

  it("fills in sensible defaults when process:started fields are missing", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: Record<string, unknown>) => void;
    act(() => {
      handler({ type: "process:started", runId: "r1" });
    });

    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    expect(typeof entry.startedAt).toBe("string");
  });

  it("removes a process on a 'process:completed' SSE event", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toHaveLength(1));

    const handler = mockUseSSE.mock.calls[0]![0] as (e: Record<string, unknown>) => void;
    act(() => {
      handler({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toHaveLength(0);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
  });

  it("appends chunks on 'process:output' SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: Record<string, unknown>) => void;
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "line 1\n" });
    });
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "line 2\n" });
    });

    expect(result.current.output).toBe("line 1\nline 2\n");
  });

  it("truncates output to the last 8192 characters when it grows too large", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: Record<string, unknown>) => void;
    const bigChunk = "a".repeat(9000);
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: bigChunk });
    });

    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output).toBe("a".repeat(8192));
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: Record<string, unknown>) => void;
    act(() => {
      handler({ type: "process:started", runId: "other-run", processId: "px" });
    });

    expect(result.current.processes).toHaveLength(0);
  });

  it("ignores a 'process:output' event with an empty/falsy chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const handler = mockUseSSE.mock.calls[0]![0] as (e: Record<string, unknown>) => void;
    act(() => {
      handler({ type: "process:output", runId: "r1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });
});
