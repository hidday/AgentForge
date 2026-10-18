import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe("useSSE", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    // @ts-expect-error -- jsdom has no EventSource; install our fake
    global.EventSource = FakeEventSource;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens an EventSource to the events stream endpoint on mount", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(FakeEventSource.instances.length).toBe(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and invokes the callback with the parsed event", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };

    act(() => {
      source.onmessage!({ data: JSON.stringify(event) });
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed (non-JSON) message data instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.onmessage!({ data: "not valid json" });
      });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the EventSource reports an error", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.onerror!();
      });
    }).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
  });

  it("does not open a new EventSource when the callback identity changes across renders", () => {
    let onEvent = vi.fn();
    const { rerender } = renderHook(() => useSSE(onEvent));

    expect(FakeEventSource.instances.length).toBe(1);

    onEvent = vi.fn();
    rerender();

    // Effect that creates the EventSource has an empty dependency array,
    // so changing the callback should not recreate the connection.
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it("always calls the latest callback passed in, even after a rerender with a new function", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: firstCallback },
    });

    rerender({ cb: secondCallback });

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };

    act(() => {
      source.onmessage!({ data: JSON.stringify(event) });
    });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith(event);
  });
});
