import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// NOTE: the requested file `ui/src/hooks/useProcesses.ts` does not exist in
// this codebase. The hook matching that description (active-process polling
// + SSE updates) is `useActiveProcesses.ts`, so it is tested here instead.

vi.mock("@/api/client.ts", () => ({
  api: {
    getActiveProcesses: vi.fn(),
    getProcessOutput: vi.fn(),
  },
}));

let sseCallback: ((event: unknown) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((cb: (event: unknown) => void) => {
    sseCallback = cb;
  }),
}));

import { useActiveProcesses } from "./useActiveProcesses";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const PROC = {
  id: "p1",
  pid: 123,
  command: "npm test",
  runId: "r1",
  stage: "Implementing",
  runtime: "claude",
  startedAt: "2024-01-01T00:00:00Z",
  elapsedMs: 10,
};

describe("useActiveProcesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("starts with no processes, no output, and hasActive=false", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
    expect(result.current.activeProcessId).toBeNull();
    expect(result.current.output).toBe("");

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalledWith("r1"));
  });

  it("loads active processes and fetches output for the first one", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello\n" });

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([PROC]));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    await waitFor(() => expect(result.current.output).toBe("hello\n"));
    expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("swallows a getProcessOutput failure (process may have just ended)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(result.current.processes).toEqual([PROC]));
    // Output stays empty rather than throwing.
    expect(result.current.output).toBe("");
  });

  it("swallows a getActiveProcesses failure (server may be restarting)", async () => {
    mockApi.getActiveProcesses.mockRejectedValue(new Error("down"));

    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("adds a process on a process:started SSE event and resets output", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: "r1",
        processId: "p2",
        command: "pnpm build",
        stage: "Implementing",
        runtime: "claude",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    expect(result.current.processes[0]).toMatchObject({
      id: "p2",
      command: "pnpm build",
      runId: "r1",
    });
    expect(result.current.output).toBe("");
  });

  it("falls back to empty strings / a generated timestamp for a process:started event missing optional fields", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:started", runId: "r1" });
    });

    expect(result.current.processes).toHaveLength(1);
    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    expect(typeof entry.startedAt).toBe("string");
    expect(entry.startedAt.length).toBeGreaterThan(0);
  });

  it("bails out of applying the fetched process output when unmounted while the output request is in flight", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1"));

    unmount();

    expect(() => resolveOutput({ processId: "p1", output: "late output" })).not.toThrow();
    // Output was never applied to state since the effect had been cancelled.
    expect(result.current.output).toBe("");
  });

  it("removes a process on a process:completed SSE event", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [PROC] });
    mockApi.getProcessOutput.mockResolvedValue({ processId: "p1", output: "" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([PROC]));

    act(() => {
      sseCallback!({ type: "process:completed", runId: "r1", processId: "p1" });
    });

    expect(result.current.processes).toEqual([]);
    expect(result.current.hasActive).toBe(false);
  });

  it("appends output chunks on process:output SSE events", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "line1\n" });
    });
    expect(result.current.output).toBe("line1\n");

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "line2\n" });
    });
    expect(result.current.output).toBe("line1\nline2\n");
  });

  it("truncates accumulated output to the last 8192 characters", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "a".repeat(5000) });
    });
    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "b".repeat(5000) });
    });

    expect(result.current.output.length).toBe(8192);
    expect(result.current.output.endsWith("b".repeat(5000))).toBe(true);
  });

  it("ignores process:output events with an empty/falsy chunk", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({ type: "process:output", runId: "r1", chunk: "" });
    });

    expect(result.current.output).toBe("");
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      sseCallback!({
        type: "process:started",
        runId: "other",
        processId: "p9",
      });
    });

    expect(result.current.processes).toEqual([]);
  });

  it("does not update state after unmount when the init fetch resolves late", async () => {
    let resolveProcesses!: (v: { processes: typeof PROC[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((res) => {
        resolveProcesses = res;
      }),
    );

    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    // Resolving after unmount should not throw (cancelled guard).
    expect(() => {
      resolveProcesses({ processes: [PROC] });
    }).not.toThrow();
  });
});
