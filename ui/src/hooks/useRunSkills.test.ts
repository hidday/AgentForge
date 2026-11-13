import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills.ts";
import { api } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor() {
    MockEventSource.instances.push(this);
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const SKILLS_RESPONSE = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with loading true and null data", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills("r1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("populates data on a successful fetch", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(SKILLS_RESPONSE);
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("r1");
  });

  it("sets an error message on rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("server exploded"));
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("server exploded");
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("r1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on a run:state-changed SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "run:state-changed", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("refetches on a run:artifact-created SSE event for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "run:artifact-created", runId: "r1" });
    });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));
  });

  it("ignores SSE events for a different run id", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "run:state-changed", runId: "other" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("ignores SSE events of an irrelevant type for this run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    act(() => {
      MockEventSource.instances[0]!.emit({ type: "run:created", runId: "r1" });
    });

    expect(mockApi.getRunSkills).not.toHaveBeenCalled();
  });

  it("refetch triggers another call to api.getRunSkills", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("r1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });
});
