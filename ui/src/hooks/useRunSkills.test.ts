import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRunSkills } from "./useRunSkills.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

const skillsResponse = {
  injectedSkills: [{ id: "skill-1" }],
  distillationDecision: null,
  distilledSkill: null,
} as any;

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in a loading state with no data or error", () => {
    mockApi.getRunSkills.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads skills successfully and exposes the resolved data", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(skillsResponse);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("surfaces the Error message when the fetch fails", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("re-requests skills when refetch is called", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockApi.getRunSkills.mockClear();
    const updated = { ...skillsResponse, injectedSkills: [] };
    mockApi.getRunSkills.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(updated);
  });

  it.each(["run:state-changed", "run:artifact-created"])(
    "refetches when a %s SSE event for the same run arrives",
    async (eventType) => {
      mockApi.getRunSkills.mockResolvedValue(skillsResponse);
      renderHook(() => useRunSkills("run-1"));
      await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

      const source = FakeEventSource.instances[0]!;
      act(() => {
        source.onmessage?.({
          data: JSON.stringify({ type: eventType, runId: "run-1" }),
        });
      });

      await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
    },
  );

  it("ignores SSE events of an unrelated type even when the run matches", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "process:started", runId: "run-1" }),
      });
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events belonging to a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({ type: "run:state-changed", runId: "other-run" }),
      });
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("closes the SSE connection when the hook unmounts", async () => {
    mockApi.getRunSkills.mockResolvedValue(skillsResponse);
    const { unmount } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
