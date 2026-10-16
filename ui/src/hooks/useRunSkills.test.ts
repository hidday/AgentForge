import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RunSkillsResponse } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    getRunSkills: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";
import { useRunSkills } from "./useRunSkills.ts";

const mockApi = api as unknown as { getRunSkills: ReturnType<typeof vi.fn> };

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    MockEventSource.instances.push(this);
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!source) throw new Error("no EventSource instance created");
  return source;
}

function makeResponse(overrides: Partial<RunSkillsResponse> = {}): RunSkillsResponse {
  return {
    injectedSkills: [],
    distillationDecision: null,
    distilledSkill: null,
    ...overrides,
  };
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  mockApi.getRunSkills.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRunSkills", () => {
  it("starts loading and populates data on success", async () => {
    const response = makeResponse();
    mockApi.getRunSkills.mockResolvedValue(response);

    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
  });

  it("sets an error message and leaves data null when the fetch rejects with an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("skills unavailable"));

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("skills unavailable");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    mockApi.getRunSkills.mockRejectedValue("nope");

    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetch() re-invokes the API", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2);
  });

  it.each(["run:state-changed", "run:artifact-created"])(
    "refetches on a %s SSE event for the same runId",
    async (eventType) => {
      mockApi.getRunSkills.mockResolvedValue(makeResponse());

      const { result } = renderHook(() => useRunSkills("run-1"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

      await act(async () => {
        latestSource().onmessage!({
          data: JSON.stringify({ type: eventType, runId: "run-1" }),
        });
      });

      await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
    },
  );

  it("does not refetch on unrelated SSE event types for the same runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "run:created", runId: "run-1" }),
      });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("ignores SSE events for a different runId", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSource().onmessage!({
        data: JSON.stringify({ type: "run:state-changed", runId: "other-run" }),
      });
    });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("closes its SSE subscription on unmount", async () => {
    mockApi.getRunSkills.mockResolvedValue(makeResponse());

    const { result, unmount } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = latestSource();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
