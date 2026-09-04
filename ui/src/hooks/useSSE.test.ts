import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

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

  it("opens an EventSource connection to /api/events/stream", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const instance = MockEventSource.instances[0]!;
    const payload: DashboardEvent = { type: "run:created", runId: "r1" };
    instance.onmessage!({ data: JSON.stringify(payload) });

    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it("silently ignores malformed JSON message data", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const instance = MockEventSource.instances[0]!;
    expect(() => instance.onmessage!({ data: "{not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source errors (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));
    const instance = MockEventSource.instances[0]!;
    expect(() => instance.onerror!()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const instance = MockEventSource.instances[0]!;

    unmount();

    expect(instance.close).toHaveBeenCalledTimes(1);
  });

  it("always calls the latest callback without reopening the connection when it changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    expect(MockEventSource.instances).toHaveLength(1);

    rerender({ cb: second });
    // Still only one EventSource created — the effect that opens it has an
    // empty dependency array.
    expect(MockEventSource.instances).toHaveLength(1);

    const instance = MockEventSource.instances[0]!;
    const payload: DashboardEvent = { type: "run:created", runId: "r2" };
    instance.onmessage!({ data: JSON.stringify(payload) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(payload);
  });
});
