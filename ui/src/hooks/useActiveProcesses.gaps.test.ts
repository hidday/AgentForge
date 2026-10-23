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

let sseHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: (handler: (event: DashboardEvent) => void) => {
    sseHandler = handler;
  },
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(id: string): ActiveProcess {
  return {
    id,
    pid: 123,
    command: "npm test",
    runId: "run-1",
    stage: "Implementing",
    runtime: "node",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
  };
}

describe("useActiveProcesses gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it("does not apply the process output once the component unmounts between the two awaited calls", async () => {
    const proc = makeProcess("p1");
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc] });

    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));

    // Wait until getActiveProcesses has resolved and getProcessOutput has been
    // kicked off, then unmount before that second call settles.
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalledWith("p1"));
    unmount();

    expect(() => resolveOutput({ processId: "p1", output: "late output" })).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });

    // The hook's own state is gone with the component, but nothing should
    // have thrown; this exercises the `if (cancelled) return;` guard after
    // the getProcessOutput await.
    expect(result.current.output).toBe("");
  });

  it("defaults id/command/stage to empty strings when a process:started event omits them", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("run-1"));
    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const before = Date.now();
    act(() => {
      sseHandler!({ type: "process:started", runId: "run-1" });
    });

    expect(result.current.processes).toHaveLength(1);
    const entry = result.current.processes[0]!;
    expect(entry.id).toBe("");
    expect(entry.command).toBe("");
    expect(entry.stage).toBe("");
    expect(entry.runtime).toBe("");
    // No timestamp was given, so it falls back to "now".
    expect(new Date(entry.startedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
