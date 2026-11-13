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

  it("opens an EventSource against the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    MockEventSource.instances[0]!.emit(event);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("swallows malformed event payloads instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    expect(() => MockEventSource.instances[0]!.emitRaw("not json")).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors (auto-reconnect is implicit)", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(() => MockEventSource.instances[0]!.triggerError()).not.toThrow();
  });

  it("always calls the latest callback even if the identity passed in changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    MockEventSource.instances[0]!.emit(event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const instance = MockEventSource.instances[0]!;
    expect(instance.closed).toBe(false);
    unmount();
    expect(instance.closed).toBe(true);
  });

  it("does not open a second EventSource when the component re-renders", () => {
    const { rerender } = renderHook(() => useSSE(vi.fn()));
    rerender();
    rerender();
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
