import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  close = vi.fn();
  onmessage: ((msg: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

describe("useSSE", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource against /api/events/stream on mount", () => {
    renderHook(() => useSSE(() => {}));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/events/stream");
  });

  it("delivers parsed messages to the provided callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0];
    const payload: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage?.({ data: JSON.stringify(payload) });
    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it("silently ignores malformed JSON instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0];
    expect(() => source.onmessage?.({ data: "{not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires (EventSource auto-reconnects)", () => {
    renderHook(() => useSSE(() => {}));
    const source = MockEventSource.instances[0];
    expect(() => source.onerror?.()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(() => {}));
    const source = MockEventSource.instances[0];
    expect(source.close).not.toHaveBeenCalled();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("does not recreate the EventSource when the callback identity changes", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: callback },
    });
    expect(MockEventSource.instances).toHaveLength(1);

    const newCallback = vi.fn();
    rerender({ cb: newCallback });
    expect(MockEventSource.instances).toHaveLength(1); // still just one EventSource

    const source = MockEventSource.instances[0];
    const payload: DashboardEvent = { type: "run:created", runId: "run-2" };
    source.onmessage?.({ data: JSON.stringify(payload) });

    expect(callback).not.toHaveBeenCalled();
    expect(newCallback).toHaveBeenCalledWith(payload);
  });
});
