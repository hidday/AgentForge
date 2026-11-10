import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins multiple plain class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values (false, null, undefined, empty string)", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("merges conflicting classes across arguments that come from arrays", () => {
    expect(cn(["text-sm", "text-lg"])).toBe("text-lg");
  });

  it("returns an empty string when given nothing meaningful", () => {
    expect(cn()).toBe("");
    expect(cn(false, undefined, null)).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps less than 60 seconds old", () => {
    const now = new Date("2024-01-01T00:00:30.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00.000Z")).toBe("just now");
  });

  it("returns '<N>m ago' for timestamps in the last hour", () => {
    const now = new Date("2024-01-01T00:10:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:05:00.000Z")).toBe("5m ago");
  });

  it("returns '<N>h ago' for timestamps in the last day", () => {
    const now = new Date("2024-01-02T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T21:00:00.000Z")).toBe("3h ago");
  });

  it("returns '<N>d ago' for timestamps older than a day", () => {
    const now = new Date("2024-01-10T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-05T00:00:00.000Z")).toBe("5d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    const now = new Date("2024-01-01T00:00:10.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T00:00:00.000Z"))).toBe("just now");
  });

  it("treats a timestamp equal to now (0 seconds elapsed) as 'just now'", () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00.000Z")).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a string date into a short month/day/time string", () => {
    const result = formatTimestamp("2024-03-05T10:30:45.000Z");
    expect(typeof result).toBe("string");
    // en-US short format always includes a comma-separated month/day segment
    expect(result).toMatch(/^[A-Za-z]{3} \d{1,2}, /);
    // and a time segment with hours:minutes:seconds
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("accepts a Date instance directly", () => {
    const result = formatTimestamp(new Date("2024-03-05T10:30:45.000Z"));
    expect(result).toMatch(/^[A-Za-z]{3} \d{1,2}, /);
  });

  it("produces the same output for an equivalent string and Date input", () => {
    const iso = "2024-06-15T08:00:00.000Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });
});
