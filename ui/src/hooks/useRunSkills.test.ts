import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEventSource.instances.push(this);
  }
}

function emit(source: FakeEventSource, event: Record<string, unknown>) {
  act(() => {
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
  });
}

const SKILLS_RESPONSE = {
  injectedSkills: [],
  distillationDecision: null,
  distilledSkill: null,
};

describe("useRunSkills", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches skills for the given run on mount", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApi.getRunSkills).toHaveBeenCalledWith("run-1");
    expect(result.current.data).toEqual(SKILLS_RESPONSE);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message on fetch failure", async () => {
    mockApi.getRunSkills.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
  });

  it("falls back to a generic error message for non-Error rejections", async () => {
    mockApi.getRunSkills.mockRejectedValue("boom");
    const { result } = renderHook(() => useRunSkills("run-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch run skills");
  });

  it("refetches on run:state-changed events for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:state-changed", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("refetches on run:artifact-created events for the same run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:artifact-created", runId: "run-1" });

    await waitFor(() => expect(mockApi.getRunSkills).toHaveBeenCalledTimes(2));
  });

  it("does not refetch for unrelated event types", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "process:started", runId: "run-1" });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("does not refetch for events belonging to a different run", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const source = FakeEventSource.instances[0]!;
    emit(source, { type: "run:state-changed", runId: "run-2" });

    expect(mockApi.getRunSkills).toHaveBeenCalledTimes(1);
  });

  it("exposes refetch for manual reloads", async () => {
    mockApi.getRunSkills.mockResolvedValue(SKILLS_RESPONSE);
    const { result } = renderHook(() => useRunSkills("run-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = { ...SKILLS_RESPONSE, distilledSkill: { id: "s1" } };
    mockApi.getRunSkills.mockResolvedValueOnce(updated as never);
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual(updated);
  });
});
