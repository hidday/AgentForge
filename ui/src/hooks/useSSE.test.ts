import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  emitRaw(data: string) {
    this.onmessage?.({ data } as MessageEvent);
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

  it("connects to the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    FakeEventSource.instances[0]!.emit(event);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed (non-JSON) event payloads", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() => FakeEventSource.instances[0]!.emitRaw("not json")).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(() => FakeEventSource.instances[0]!.onerror?.(new Event("error"))).not.toThrow();
  });

  it("always calls the latest callback even if the callback identity changes across renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    FakeEventSource.instances[0]!.emit(event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));

    const instance = FakeEventSource.instances[0]!;
    expect(instance.closed).toBe(false);

    unmount();

    expect(instance.closed).toBe(true);
  });
});
