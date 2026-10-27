import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
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

  it("connects to the dashboard events stream endpoint on mount", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event when a message arrives", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed JSON messages instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = MockEventSource.instances[0]!;
    expect(() => {
      source.onmessage!({ data: "{not valid json" } as MessageEvent);
    }).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(() => {
      source.onerror!(new Event("error"));
    }).not.toThrow();
  });

  it("always calls the latest callback without re-creating the EventSource on re-render", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: firstCallback },
    });

    expect(MockEventSource.instances).toHaveLength(1);

    rerender({ cb: secondCallback });
    // Still only one EventSource — the effect that opens the connection has no deps on the callback.
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r2" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;

    expect(source.close).not.toHaveBeenCalled();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
