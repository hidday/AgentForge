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

let capturedHandler: ((event: DashboardEvent) => void) | null = null;
vi.mock("./useSSE.ts", () => ({
  useSSE: vi.fn((handler: (event: DashboardEvent) => void) => {
    capturedHandler = handler;
  }),
}));

import { useActiveProcesses } from "./useActiveProcesses.ts";
import { api } from "@/api/client.ts";

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

function makeProcess(overrides: Partial<ActiveProcess> = {}): ActiveProcess {
  return {
    id: "proc-1",
    pid: 123,
    command: "run executor",
    runId: "run-1",
    stage: "executing",
    runtime: "claude",
    startedAt: "2024-01-01T00:00:00Z",
    elapsedMs: 0,
    ...overrides,
  };
}

describe("useActiveProcesses – additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
  });

  it("does not apply a late getProcessOutput result after unmount (cancelled guard mid-output-fetch)", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [makeProcess()] });

    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((res) => {
        resolveOutput = res;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("run-1"));

    // Let getActiveProcesses resolve and getProcessOutput be called, but
    // unmount before getProcessOutput itself resolves.
    await waitFor(() => expect(mockApi.getProcessOutput).toHaveBeenCalled());
    unmount();

    expect(() => {
      resolveOutput({ processId: "proc-1", output: "late output" });
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));

    // Output was never applied since the hook was unmounted first.
    expect(result.current.output).toBe("");
  });

  it("defaults missing processId/command/stage/runtime fields to empty strings on process:started", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });

    const { result } = renderHook(() => useActiveProcesses("run-1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    act(() => {
      capturedHandler!({
        type: "process:started",
        runId: "run-1",
      });
    });

    expect(result.current.processes).toHaveLength(1);
    const proc = result.current.processes[0]!;
    expect(proc.id).toBe("");
    expect(proc.command).toBe("");
    expect(proc.stage).toBe("");
    expect(proc.runtime).toBe("");
  });
});
