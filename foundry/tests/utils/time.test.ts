import { describe, it, expect } from "vitest";
import { formatDuration } from "../../src/utils/time.js";

describe("formatDuration", () => {
  it("returns '0ms' for zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("formats sub-second values in milliseconds", () => {
    expect(formatDuration(450)).toBe("450ms");
  });

  it("formats 999ms at the sub-second boundary", () => {
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats exactly one second as '1s'", () => {
    expect(formatDuration(1000)).toBe("1s");
  });

  it("truncates fractional input toward zero", () => {
    expect(formatDuration(1500.9)).toBe("1s");
  });

  it("formats 59_500ms as '59s'", () => {
    expect(formatDuration(59_500)).toBe("59s");
  });

  it("truncates (does not round) at the sub-minute boundary", () => {
    expect(formatDuration(59_999)).toBe("59s");
  });

  it("formats exactly one minute as '1m' (omits zero seconds)", () => {
    expect(formatDuration(60_000)).toBe("1m");
  });

  it("formats minutes and seconds when both are non-zero", () => {
    expect(formatDuration(83_000)).toBe("1m 23s");
  });

  it("formats exact minute multiples without seconds", () => {
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("truncates at the sub-hour boundary", () => {
    expect(formatDuration(3_599_999)).toBe("59m 59s");
  });

  it("formats exactly one hour as '1h' (omits zero minutes)", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
  });

  it("formats hours and minutes when both are non-zero", () => {
    expect(formatDuration(3_660_000)).toBe("1h 1m");
  });

  it("drops seconds at the hour scale", () => {
    expect(formatDuration(7_505_000)).toBe("2h 5m");
  });

  it("throws RangeError for negative integers", () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
  });

  it("throws RangeError whose message names the helper", () => {
    expect(() => formatDuration(-1)).toThrow(/formatDuration/);
  });

  it("throws RangeError for negative fractional values", () => {
    expect(() => formatDuration(-0.5)).toThrow(RangeError);
  });

  it("throws RangeError for NaN", () => {
    expect(() => formatDuration(Number.NaN)).toThrow(RangeError);
  });

  it("throws RangeError for positive Infinity", () => {
    expect(() => formatDuration(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("throws RangeError for negative Infinity", () => {
    expect(() => formatDuration(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });
});
