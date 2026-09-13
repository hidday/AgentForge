import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  emitRawMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError() {
    this.onerror?.();
  }
}

describe("useSSE", () => {
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(() => {
    FakeEventSource.instances = [];
    originalEventSource = (global as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (global as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it("opens an EventSource connection to the events stream endpoint", () => {
    renderHook(() => useSSE(vi.fn()));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events/stream");
  });

  it("parses incoming messages and forwards them to the callback", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-1" };

    act(() => {
      source.emitMessage(event);
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("silently ignores malformed message payloads instead of throwing", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE(onEvent));
    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.emitRawMessage("not valid json{{{");
      });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not throw when the connection reports an error (auto-reconnect no-op)", () => {
    renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;

    expect(() => {
      act(() => {
        source.emitError();
      });
    }).not.toThrow();
  });

  it("closes the EventSource connection on unmount", () => {
    const { unmount } = renderHook(() => useSSE(vi.fn()));
    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);

    unmount();

    expect(source.closed).toBe(true);
  });

  it("invokes the latest callback after the consumer passes a new function, reusing the connection", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    // The connection-opening effect has no deps, so it must not reopen.
    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0]!;
    const event: DashboardEvent = { type: "run:created", runId: "run-2" };
    act(() => {
      source.emitMessage(event);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(event);
  });
});
