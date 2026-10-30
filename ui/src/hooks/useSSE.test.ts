import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
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

  it("opens an EventSource connection to the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and forwards them to the callback", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    act(() => {
      source.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
    });
    expect(cb).toHaveBeenCalledWith(event);
  });

  it("ignores malformed message data without throwing", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const source = MockEventSource.instances[0]!;
    expect(() => {
      act(() => {
        source.onmessage?.({ data: "not valid json" } as MessageEvent);
      });
    }).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not throw or close the connection when an error event fires", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(() => {
      act(() => {
        source.onerror?.(new Event("error"));
      });
    }).not.toThrow();
    expect(source.closed).toBe(false);
  });

  it("uses the latest callback without opening a new connection when the callback identity changes", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: cb1 },
    });
    expect(MockEventSource.instances.length).toBe(1);

    rerender({ cb: cb2 });
    expect(MockEventSource.instances.length).toBe(1);

    const source = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    act(() => {
      source.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
    });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = MockEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });
});
