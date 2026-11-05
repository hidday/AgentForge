import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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

  it("opens an EventSource connection to the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages as JSON and forwards them to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const instance = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:state-changed", runId: "run-1" };

    act(() => {
      instance.onmessage!({ data: JSON.stringify(event) });
    });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed (non-JSON) message data", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const instance = MockEventSource.instances[0]!;

    expect(() => {
      act(() => {
        instance.onmessage!({ data: "not valid json" });
      });
    }).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires", () => {
    renderHook(() => useSSE(vi.fn()));
    const instance = MockEventSource.instances[0]!;

    expect(() => {
      act(() => {
        instance.onerror!();
      });
    }).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const instance = MockEventSource.instances[0]!;

    expect(instance.closed).toBe(false);
    unmount();
    expect(instance.closed).toBe(true);
  });

  it("always calls the latest callback without re-opening the connection when it changes", () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    expect(MockEventSource.instances).toHaveLength(1);

    rerender({ cb: second });
    // Still only one EventSource — the connection effect has an empty dep array.
    expect(MockEventSource.instances).toHaveLength(1);

    const instance = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };

    act(() => {
      instance.onmessage!({ data: JSON.stringify(event) });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
