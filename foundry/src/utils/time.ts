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
