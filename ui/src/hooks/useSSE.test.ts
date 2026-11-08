import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
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

  it("opens exactly one EventSource against /api/events/stream", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses a valid message and forwards the event to the callback", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };

    source.onmessage!({ data: JSON.stringify(event) });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed message data instead of throwing", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const source = MockEventSource.instances[0]!;

    expect(() => source.onmessage!({ data: "not valid json" })).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not throw when the underlying EventSource reports an error", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;

    expect(() => source.onerror!()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
  });

  it("does not open a new EventSource when the callback identity changes, and dispatches to the latest callback", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), { initialProps: { cb: cb1 } });
    expect(MockEventSource.instances).toHaveLength(1);

    rerender({ cb: cb2 });
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith(event);
  });
});
