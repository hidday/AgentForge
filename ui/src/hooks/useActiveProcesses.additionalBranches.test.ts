import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActiveProcesses } from "./useActiveProcesses.ts";
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

const mockApi = api as unknown as {
  getActiveProcesses: ReturnType<typeof vi.fn>;
  getProcessOutput: ReturnType<typeof vi.fn>;
};

const proc1 = {
  id: "p1",
  pid: 123,
  command: "run-tests",
  runId: "r1",
  stage: "executing",
  runtime: "codex",
  startedAt: "2026-01-01T00:00:00Z",
  elapsedMs: 10,
};

function fireSSE(event: DashboardEvent) {
  if (!sseCallback) throw new Error("SSE callback not registered yet");
  act(() => {
    sseCallback!(event);
  });
}

describe("useActiveProcesses additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallback = null;
  });

  it("does not update state after unmount once getActiveProcesses resolves late", async () => {
    let resolveProcesses!: (v: { processes: typeof proc1[] }) => void;
    mockApi.getActiveProcesses.mockReturnValue(
      new Promise((resolve) => {
        resolveProcesses = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    unmount();

    await act(async () => {
      resolveProcesses({ processes: [proc1] });
      await Promise.resolve();
    });

    // Hook was unmounted before the response landed — state must stay at
    // its initial values rather than throwing or leaking an update.
    expect(result.current.processes).toEqual([]);
    expect(mockApi.getProcessOutput).not.toHaveBeenCalled();
  });

  it("does not update output after unmount once getProcessOutput resolves late", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [proc1] });
    let resolveOutput!: (v: { processId: string; output: string }) => void;
    mockApi.getProcessOutput.mockReturnValue(
      new Promise((resolve) => {
        resolveOutput = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useActiveProcesses("r1"));
    await waitFor(() => expect(result.current.processes).toEqual([proc1]));

    unmount();

    await act(async () => {
      resolveOutput({ processId: "p1", output: "late output" });
      await Promise.resolve();
    });

    expect(result.current.output).toBe("");
  });

  it("defaults all optional fields on a process:started event missing them", async () => {
    mockApi.getActiveProcesses.mockResolvedValue({ processes: [] });
    const { result } = renderHook(() => useActiveProcesses("r1"));

    await waitFor(() => expect(mockApi.getActiveProcesses).toHaveBeenCalled());

    const before = Date.now();
    fireSSE({ type: "process:started", runId: "r1" });
    const after = Date.now();

    expect(result.current.processes).toHaveLength(1);
    const proc = result.current.processes[0];
    expect(proc.id).toBe("");
    expect(proc.command).toBe("");
    expect(proc.stage).toBe("");
    expect(proc.runtime).toBe("");
    const startedAtMs = new Date(proc.startedAt).getTime();
    expect(startedAtMs).toBeGreaterThanOrEqual(before);
    expect(startedAtMs).toBeLessThanOrEqual(after);
  });
});
