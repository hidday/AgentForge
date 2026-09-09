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

  it("parses incoming messages as JSON and invokes the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed JSON payloads instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = MockEventSource.instances[0]!;
    expect(() => {
      source.onmessage!({ data: "{not valid json" } as MessageEvent);
    }).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source reports an error", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(() => source.onerror!(new Event("error"))).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("does not open a new EventSource when the callback prop changes identity", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    expect(MockEventSource.instances).toHaveLength(1);

    rerender({ cb: second });
    expect(MockEventSource.instances).toHaveLength(1);

    // The latest callback is the one invoked, proving the ref was updated.
    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
