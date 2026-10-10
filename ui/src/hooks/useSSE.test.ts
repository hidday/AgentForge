import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class MockEventSource {
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  static instances: MockEventSource[] = [];

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSSE", () => {
  it("opens an EventSource pointed at the events stream", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("calls the callback with the parsed event on a well-formed message", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const instance = MockEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    act(() => {
      instance.onmessage!({ data: JSON.stringify(event) });
    });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(event);
  });

  it("silently swallows a malformed/non-JSON message", () => {
    const cb = vi.fn();
    renderHook(() => useSSE(cb));
    const instance = MockEventSource.instances[0]!;

    expect(() => {
      act(() => {
        instance.onmessage!({ data: "not-json{{{" });
      });
    }).not.toThrow();

    expect(cb).not.toHaveBeenCalled();
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

  it("uses the latest callback after a re-render without creating a new EventSource", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    expect(MockEventSource.instances.length).toBe(1);

    const instance = MockEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    act(() => {
      instance.onmessage!({ data: JSON.stringify(event) });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(event);
  });
});
