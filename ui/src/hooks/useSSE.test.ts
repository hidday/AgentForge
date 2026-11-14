import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
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

  it("opens a connection to the dashboard events stream", () => {
    renderHook(() => useSSE(vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/events/stream");
  });

  it("invokes the callback with the parsed event on message", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0];
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("ignores a malformed message instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));

    const source = FakeEventSource.instances[0];
    expect(() => source.onmessage?.({ data: "not json" } as MessageEvent)).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when onerror fires (auto-reconnect is left to the browser)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0];
    expect(() => source.onerror?.()).not.toThrow();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0];
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("always calls the latest callback without reopening the connection when it changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: (e: DashboardEvent) => void }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0];
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };
    source.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
