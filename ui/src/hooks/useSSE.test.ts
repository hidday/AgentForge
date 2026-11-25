import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  emitRaw(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  triggerError() {
    this.onerror?.(new Event("error"));
  }
}

describe("useSSE", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource pointed at /api/events/stream", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toBe("/api/events/stream");
  });

  it("parses incoming message data and invokes the callback with the parsed event", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0];

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.emit(event);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("swallows malformed JSON in message data without throwing or calling the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0];

    expect(() => source.emitRaw("not valid json{{{")).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source errors (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0];
    expect(() => source.triggerError()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0];
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("always calls the latest callback without re-creating the EventSource when it changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    expect(MockEventSource.instances.length).toBe(1);

    rerender({ cb: second });
    // Still only one EventSource instance created (effect has empty deps)
    expect(MockEventSource.instances.length).toBe(1);

    const source = MockEventSource.instances[0];
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    source.emit(event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
