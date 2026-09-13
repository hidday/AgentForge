import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

import { api, type RunSkillsResponse, type SkillDocument } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";
import type { DashboardEvent } from "./useSSE.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: DashboardEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  }
}

const skill: SkillDocument = {
  id: "skill-1",
  repoSlug: "org/repo",
  name: "some-skill",
  description: "desc",
  taskCategory: "cat",
  skillMarkdown: "# skill",
  utilityScore: 1,
  lastUsedAt: "2024-01-01T00:00:00Z",
};

function makeResponse(overrides: Partial<RunSkillsResponse> = {}): RunSkillsResponse {
  return {
    injectedSkills: [skill],
    distillationDecision: null,
    distilledSkill: null,
    ...overrides,
  };
}

describe("useRunSkills", () => {
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    originalEventSource = (global as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (global as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it("starts in a loading state with no data or error", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads run skills successfully", async () => {
    const response = makeResponse();
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets the error message from an Error rejection and leaves data null", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("some string failure");

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed SSE event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "run:state-changed", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on a run:artifact-created SSE event for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "run:artifact-created", runId: "run-1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("ignores SSE events of an unrelated type for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "run:created", runId: "run-1" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events for a different run even when the type matches", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: "run:state-changed", runId: "other-run" });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function that re-invokes the API", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it("closes the SSE connection on unmount", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    const { unmount } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalled());

    const source = FakeEventSource.instances[0]!;
    unmount();

    expect(source.closed).toBe(true);
  });

  it("refetches for the new runId when runId changes", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());
    const { rerender } = renderHook(({ runId }) => useRunSkills(runId), {
      initialProps: { runId: "run-1" },
    });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1"));

    rerender({ runId: "run-2" });
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-2"));
  });
});
