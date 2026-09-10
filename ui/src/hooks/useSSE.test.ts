import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
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

  it("opens a connection to the events stream endpoint", () => {
    renderHook(() => useSSE(() => {}));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and forwards them to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed message payloads", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = MockEventSource.instances[0]!;
    expect(() =>
      source.onmessage!({ data: "not json" } as MessageEvent),
    ).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the source errors", () => {
    renderHook(() => useSSE(() => {}));
    const source = MockEventSource.instances[0]!;
    expect(() => source.onerror!()).not.toThrow();
  });

  it("uses the latest callback without reopening the connection", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
    expect(second).toHaveBeenCalledWith(event);
    expect(first).not.toHaveBeenCalled();
  });

  it("closes the connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(() => {}));
    const source = MockEventSource.instances[0]!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
