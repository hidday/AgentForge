import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
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

  it("opens a connection to /api/events/stream", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and forwards them to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed JSON payloads", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;
    expect(() => {
      source.onmessage!({ data: "{not valid json" } as MessageEvent);
    }).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection errors (auto-reconnect is implicit)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(() => source.onerror!(new Event("error"))).not.toThrow();
  });

  it("always invokes the latest callback even if the callback reference changes between renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    source.onmessage!({ data: JSON.stringify(event) } as MessageEvent);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
