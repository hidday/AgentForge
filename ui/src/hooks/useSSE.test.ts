import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
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
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource against /api/events/stream", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances.length).toBe(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and forwards them to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    act(() => {
      source.onmessage!({ data: JSON.stringify(event) });
    });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed message payloads", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.onmessage!({ data: "{not valid json" });
      });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(() => {
      act(() => {
        source.onerror!();
      });
    }).not.toThrow();
  });

  it("always calls the latest callback, even after the consumer passes a new function", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    const source = FakeEventSource.instances[0]!;

    rerender({ cb: second });

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    act(() => {
      source.onmessage!({ data: JSON.stringify(event) });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource and does not reopen a new one on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it("opens only one EventSource across re-renders with a stable callback reference", () => {
    const cb = vi.fn();
    const { rerender } = renderHook(() => useSSE(cb));
    rerender();
    rerender();
    expect(FakeEventSource.instances.length).toBe(1);
  });
});
