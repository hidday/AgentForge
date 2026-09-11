import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
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

  it("opens a connection to the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    FakeEventSource.instances[0]!.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("ignores malformed event payloads instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    expect(() =>
      FakeEventSource.instances[0]!.onmessage?.({ data: "not json" } as MessageEvent),
    ).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(() => FakeEventSource.instances[0]!.onerror?.(new Event("error"))).not.toThrow();
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));

    const instance = FakeEventSource.instances[0]!;
    expect(instance.closed).toBe(false);

    unmount();

    expect(instance.closed).toBe(true);
  });

  it("always invokes the latest callback even after the hook re-renders", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: firstCallback },
    });

    rerender({ cb: secondCallback });

    // Only one EventSource should have been created (effect deps are stable).
    expect(FakeEventSource.instances).toHaveLength(1);

    const event: DashboardEvent = { type: "run:created", runId: "r1" };
    FakeEventSource.instances[0]!.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledWith(event);
  });
});
