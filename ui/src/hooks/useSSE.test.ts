import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
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

  it("connects to the events stream endpoint on mount", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses an incoming message and invokes the callback with the event", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores a malformed message instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0]!;

    expect(() => source.onmessage!({ data: "not json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(() => source.onerror!()).not.toThrow();
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("always calls the latest callback, even after the consumer passes a new function without remounting", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
    // Only one connection should have been opened despite the rerender.
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
