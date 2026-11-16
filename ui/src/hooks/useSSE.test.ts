import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  url: string;
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
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a single EventSource connection to the dashboard stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming message data and forwards it to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;
    const payload: DashboardEvent = { type: "run:created", runId: "run-1" };

    act(() => {
      source.onmessage?.({ data: JSON.stringify(payload) });
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it("silently ignores malformed JSON instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.onmessage?.({ data: "{not valid json" });
      });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection reports an error", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.onerror?.(new Event("error"));
      });
    }).not.toThrow();
  });

  it("uses the latest callback on re-render without opening a new connection", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    const payload: DashboardEvent = { type: "run:created", runId: "run-2" };

    act(() => {
      source.onmessage?.({ data: JSON.stringify(payload) });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(payload);
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
  });
});
