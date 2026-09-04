import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins simple class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    const shouldInclude = false;
    expect(cn("a", shouldInclude && "b", undefined, null, "c")).toBe("a c");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ foo: true, bar: false }, "baz")).toBe("foo baz");
  });

  it("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp under a minute old", () => {
    const now = new Date("2024-01-01T00:00:30Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes for a timestamp under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:10:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("returns hours for a timestamp under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T05:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days for a timestamp a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-05T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date object as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:45Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("just now");
  });

  it("handles exactly 60 seconds by rolling over to minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a human readable en-US timestamp", () => {
    const result = formatTimestamp("2024-03-15T10:30:00Z");
    // Exact wording depends on ICU data / TZ, so assert on structure instead
    // of a fully pinned string.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
  });

  it("accepts a Date object", () => {
    const result = formatTimestamp(new Date("2024-06-01T00:00:00Z"));
    expect(result).toMatch(/Jun/);
  });

  it("includes hour, minute and second components", () => {
    const result = formatTimestamp("2024-01-01T12:34:56Z");
    // en-US locale uses colons between numeric time components
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});
