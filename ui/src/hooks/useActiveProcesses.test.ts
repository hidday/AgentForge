import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DashboardEvent } from "./useSSE.ts";

vi.mock("@/api/client.ts", () => ({
  api: { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() },
}));

let sseCallback: ((e: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (cb: (e: DashboardEvent) => void) => {
    sseCallback = cb;
  },
}));

import { api } from "@/api/client.ts";
import { useActiveProcesses } from "./useActiveProcesses.ts";

const getActiveProcesses = api.getActiveProcesses as unknown as ReturnType<typeof vi.fn>;
const getProcessOutput = api.getProcessOutput as unknown as ReturnType<typeof vi.fn>;

const proc = {
  id: "p1",
  pid: 123,
  command: "claude",
  runId: "r1",
  stage: "planning",
  runtime: "claude",
  startedAt: "2026-01-01T00:00:00Z",
  elapsedMs: 10,
};

function fire(e: DashboardEvent) {
  act(() => sseCallback!(e));
}

beforeEach(() => {
  getActiveProcesses.mockReset();
  getProcessOutput.mockReset();
  sseCallback = null;
});

describe("useActiveProcesses", () => {
  it("is empty when there are no processes and does not fetch output", async () => {
    getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(getActiveProcesses).toHaveBeenCalledWith("r1"));
    expect(result.current).toEqual({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
    expect(getProcessOutput).not.toHaveBeenCalled();
  });

  it("loads existing processes and the first one's output", async () => {
    getActiveProcesses.mockResolvedValue({ processes: [proc] });
    getProcessOutput.mockResolvedValue({ processId: "p1", output: "hello" });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.output).toBe("hello"));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.activeProcessId).toBe("p1");
    expect(getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("tolerates output fetch failure", async () => {
    getActiveProcesses.mockResolvedValue({ processes: [proc] });
    getProcessOutput.mockRejectedValue(new Error("ended"));
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.hasActive).toBe(true));
    await waitFor(() => expect(getProcessOutput).toHaveBeenCalled());
    expect(result.current.output).toBe("");
  });

  it("tolerates process list fetch failure", async () => {
    getActiveProcesses.mockRejectedValue(new Error("restarting"));
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(getActiveProcesses).toHaveBeenCalled());
    expect(result.current.processes).toEqual([]);
  });

  it("ignores results that resolve after unmount", async () => {
    let resolveList!: (v: unknown) => void;
    getActiveProcesses.mockReturnValue(new Promise((r) => (resolveList = r)));
    const { unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();
    await act(async () => {
      resolveList({ processes: [proc] });
    });
    expect(getProcessOutput).not.toHaveBeenCalled();
  });

  it("ignores output that resolves after unmount", async () => {
    let resolveOutput!: (v: unknown) => void;
    getActiveProcesses.mockResolvedValue({ processes: [proc] });
    getProcessOutput.mockReturnValue(new Promise((r) => (resolveOutput = r)));
    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(getProcessOutput).toHaveBeenCalled());
    unmount();
    await act(async () => {
      resolveOutput({ processId: "p1", output: "late" });
    });
    expect(result.current.output).toBe("");
  });

  it("tracks process lifecycle and output via SSE", async () => {
    getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(getActiveProcesses).toHaveBeenCalled());

    fire({
      type: "process:started",
      runId: "r1",
      processId: "p9",
      command: "codex",
      stage: "implementing",
      runtime: "codex",
      timestamp: "2026-02-02T00:00:00Z",
    });
    expect(result.current.activeProcessId).toBe("p9");
    expect(result.current.processes[0]).toMatchObject({
      id: "p9",
      command: "codex",
      stage: "implementing",
      runtime: "codex",
      startedAt: "2026-02-02T00:00:00Z",
      pid: 0,
      elapsedMs: 0,
    });

    fire({ type: "process:output", runId: "r1", processId: "p9", chunk: "abc" });
    fire({ type: "process:output", runId: "r1", processId: "p9", chunk: "def" });
    expect(result.current.output).toBe("abcdef");

    // empty chunk is ignored
    fire({ type: "process:output", runId: "r1", processId: "p9", chunk: "" });
    expect(result.current.output).toBe("abcdef");

    fire({ type: "process:completed", runId: "r1", processId: "p9" });
    expect(result.current.hasActive).toBe(false);
    expect(result.current.output).toBe("abcdef");
  });

  it("defaults missing fields on process:started and resets output", async () => {
    getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(getActiveProcesses).toHaveBeenCalled());
    fire({ type: "process:output", runId: "r1", chunk: "old" });
    expect(result.current.output).toBe("old");
    fire({ type: "process:started", runId: "r1" });
    const p = result.current.processes[0]!;
    expect(p.id).toBe("");
    expect(p.command).toBe("");
    expect(p.stage).toBe("");
    expect(p.runtime).toBe("");
    expect(Number.isNaN(Date.parse(p.startedAt))).toBe(false);
    expect(result.current.output).toBe("");
  });

  it("caps output at the last 8192 characters", async () => {
    getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(getActiveProcesses).toHaveBeenCalled());
    fire({ type: "process:output", runId: "r1", chunk: "a".repeat(8192) });
    expect(result.current.output).toHaveLength(8192);
    fire({ type: "process:output", runId: "r1", chunk: "XYZ" });
    expect(result.current.output).toHaveLength(8192);
    expect(result.current.output.endsWith("XYZ")).toBe(true);
    expect(result.current.output.startsWith("a")).toBe(true);
  });

  it("ignores events for other runs", async () => {
    getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(getActiveProcesses).toHaveBeenCalled());
    fire({ type: "process:started", runId: "r2", processId: "x" });
    fire({ type: "process:output", runId: "r2", chunk: "nope" });
    expect(result.current.processes).toEqual([]);
    expect(result.current.output).toBe("");
  });
});
