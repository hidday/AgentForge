export interface Timer {
  elapsed(): number;
}

export function startTimer(): Timer {
  const start = performance.now();
  return {
    elapsed(): number {
      return Math.round(performance.now() - start);
    },
  };
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Format a non-negative, finite millisecond count into a human-readable
 * duration string using four tiers:
 *   - `<n>ms` for values under one second
 *   - `<n>s` for values under one minute
 *   - `<m>m` or `<m>m <s>s` for values under one hour
 *   - `<h>h` or `<h>h <m>m` for values one hour and above
 *
 * Fractional inputs are truncated toward zero (never rounded). Throws a
 * `RangeError` for `NaN`, `±Infinity`, or any negative number.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`formatDuration: expected a non-negative finite number, got ${ms}`);
  }

  const total = Math.trunc(ms);

  if (total < MS_PER_SECOND) {
    return `${total}ms`;
  }

  if (total < MS_PER_MINUTE) {
    return `${Math.trunc(total / MS_PER_SECOND)}s`;
  }

  if (total < MS_PER_HOUR) {
    const minutes = Math.trunc(total / MS_PER_MINUTE);
    const seconds = Math.trunc((total % MS_PER_MINUTE) / MS_PER_SECOND);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }

  const hours = Math.trunc(total / MS_PER_HOUR);
  const minutes = Math.trunc((total % MS_PER_HOUR) / MS_PER_MINUTE);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
