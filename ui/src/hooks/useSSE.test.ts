import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

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

  it("opens an EventSource against the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on a valid message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed JSON instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0]!;

    expect(() => source.onmessage!({ data: "{not valid json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source reports an error", () => {
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

  it("does not open a second EventSource when the callback identity changes across renders", () => {
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: vi.fn() },
    });
    rerender({ cb: vi.fn() });
    expect(MockEventSource.instances.length).toBe(1);
  });

  it("uses the latest callback passed in after a rerender, not the stale one", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: firstCallback },
    });
    rerender({ cb: secondCallback });

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    source.onmessage!({ data: JSON.stringify(event) });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith(event);
  });
});
